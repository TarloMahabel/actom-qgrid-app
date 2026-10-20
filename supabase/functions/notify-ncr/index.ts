/* =====================================================================
   ACTOM QMS 360 — notify-ncr Edge Function

   Handles two notification types:
     raised  — sent from app.js immediately after an NCR is inserted
     digest  — sent daily by pg_cron at 05:00 UTC (07:00 SAST)

   Required Supabase secrets (set once per project via Supabase dashboard
   or `supabase secrets set`):
     RESEND_API_KEY          your Resend API key
     NOTIFY_FROM             verified sender, e.g. "QMS 360 <noreply@actom.co.za>"
     APP_URL                 this division's Netlify URL, no trailing slash
                             e.g. https://actom-qgrid-app.netlify.app
   ===================================================================== */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.0'

const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const FROM       = Deno.env.get('NOTIFY_FROM')    ?? 'QMS 360 <notifications@example.com>'
const APP_URL    = (Deno.env.get('APP_URL')        ?? '').replace(/\/$/, '')
const SVC_KEY    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const SUPA_URL   = Deno.env.get('SUPABASE_URL')   ?? ''

// ── Types ──────────────────────────────────────────────────────────────────

interface NcrRow {
  id: string
  ref: string
  status: string
  severity: string
  age_days: number
  part_description: string
  department: string | null
  raised_by_name: string | null
  origin: string
}

interface ActionRow {
  id: number
  ncr_id: string
  action: string
  owner_id: string | null
  due_date: string
}

interface ProfileRow {
  id: string
  email: string
  full_name: string
}

// ── Helpers ────────────────────────────────────────────────────────────────

const esc = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

async function send(to: string[], subject: string, html: string): Promise<void> {
  if (!RESEND_KEY || !to.length) return
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_KEY}` },
    body: JSON.stringify({ from: FROM, to, subject, html }),
  })
  if (!r.ok) console.error('Resend error', r.status, await r.text())
}

const S = {
  body:  'font-family:Arial,sans-serif;color:#1a2332;font-size:14px;line-height:1.5;margin:0;padding:24px',
  h2:    'font-size:17px;margin:0 0 16px;color:#0063AF',
  h3:    'font-size:14px;font-weight:700;margin:20px 0 8px;color:#1a2332',
  table: 'border-collapse:collapse;width:100%;margin-bottom:16px',
  th:    'background:#f4f6f9;padding:8px 12px;text-align:left;font-size:12px;font-weight:600;border:1px solid #dde3ec',
  td:    'padding:8px 12px;font-size:13px;border:1px solid #dde3ec;vertical-align:top',
  muted: 'color:#46587a;font-size:11px',
  link:  'color:#0063AF;font-weight:600',
}

function wrap(content: string): string {
  return `<!doctype html><html><body style="${S.body}">
    <p style="${S.muted};margin:0 0 20px">ACTOM QMS 360</p>
    ${content}
    <p style="margin-top:24px"><a href="${APP_URL}" style="${S.link}">Open QMS 360 →</a></p>
    <hr style="border:none;border-top:1px solid #dde3ec;margin:24px 0">
    <p style="${S.muted};margin:0">This email is sent automatically by QMS 360. Do not reply.</p>
  </body></html>`
}

function ncrTable(rows: NcrRow[], caption: string): string {
  if (!rows.length) return ''
  return `<h3 style="${S.h3}">${esc(caption)}
      <span style="font-weight:400;color:#46587a">${rows.length}</span></h3>
    <table style="${S.table}">
      <thead><tr>
        <th style="${S.th}">Reference</th><th style="${S.th}">Age</th>
        <th style="${S.th}">Department</th><th style="${S.th}">Severity</th>
        <th style="${S.th}">Status</th>
      </tr></thead>
      <tbody>${rows.map(n => `<tr>
        <td style="${S.td}"><b>${esc(n.ref)}</b></td>
        <td style="${S.td}">${esc(n.age_days)} days</td>
        <td style="${S.td}">${esc(n.department ?? '—')}</td>
        <td style="${S.td}">${esc(n.severity)}</td>
        <td style="${S.td}">${esc(n.status.replace(/_/g, ' '))}</td>
      </tr>`).join('')}</tbody>
    </table>`
}

// ── Handler ────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, content-type',
      },
    })
  }

  let body: { type?: string; ncrId?: string }
  try { body = await req.json() }
  catch { return new Response('Bad JSON', { status: 400 }) }

  const db = createClient(SUPA_URL, SVC_KEY)

  // ── raised ───────────────────────────────────────────────────────────────
  if (body.type === 'raised' && body.ncrId) {
    const { data: ncr } = await db
      .from('v_ncr_list')
      .select('*')
      .eq('id', body.ncrId)
      .single<NcrRow>()
    if (!ncr) return new Response('NCR not found', { status: 404 })

    const { data: qes } = await db
      .from('profiles')
      .select('email')
      .in('role', ['quality_engineer', 'quality_manager'])
      .eq('active', true)

    const emails = (qes ?? []).map((p: any) => p.email as string).filter(Boolean)

    const html = wrap(`
      <h2 style="${S.h2}">${esc(ncr.ref)} raised</h2>
      <table style="${S.table}">
        <tbody>
          <tr><th style="${S.th}">Part</th><td style="${S.td}">${esc(ncr.part_description)}</td></tr>
          <tr><th style="${S.th}">Severity</th><td style="${S.td}">${esc(ncr.severity)}</td></tr>
          <tr><th style="${S.th}">Department</th><td style="${S.td}">${esc(ncr.department ?? '—')}</td></tr>
          <tr><th style="${S.th}">Origin</th><td style="${S.td}">${esc((ncr.origin ?? '').replace(/_/g, ' '))}</td></tr>
          <tr><th style="${S.th}">Raised by</th><td style="${S.td}">${esc(ncr.raised_by_name ?? '—')}</td></tr>
        </tbody>
      </table>
    `)

    await send(
      emails,
      `[NCR] ${ncr.ref} raised · ${ncr.severity} · ${ncr.department ?? 'no department'}`,
      html,
    )
    return new Response(JSON.stringify({ sent: emails.length }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // ── digest ───────────────────────────────────────────────────────────────
  if (body.type === 'digest') {
    const today = new Date().toISOString().slice(0, 10)

    const { data: ncrs } = await db
      .from('v_ncr_list')
      .select('*')
      .neq('status', 'closed')
      .order('raised_at', { ascending: true })

    const all = (ncrs ?? []) as NcrRow[]
    const overdue = all.filter(n => n.age_days > 30)
    const overdueIds = new Set(overdue.map(n => n.id))
    const stalled = all.filter(
      n =>
        !overdueIds.has(n.id) &&
        ((n.status === 'open' && n.age_days > 7) ||
          (n.status === 'contained' && n.age_days > 14)),
    )

    const { data: rawActions } = await db
      .from('ncr_actions')
      .select('id, ncr_id, action, owner_id, due_date')
      .lt('due_date', today)
      .is('done_at', null)
    const actions = (rawActions ?? []) as ActionRow[]

    if (!overdue.length && !stalled.length && !actions.length) {
      return new Response(JSON.stringify({ skipped: 'nothing to report' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Enrich actions with owner info
    const ownerIds = [...new Set(actions.map(a => a.owner_id).filter(Boolean))] as string[]
    const { data: ownerRows } = ownerIds.length
      ? await db.from('profiles').select('id, email, full_name').in('id', ownerIds)
      : { data: [] as ProfileRow[] }
    const ownerMap = new Map((ownerRows ?? []).map((p: any) => [p.id, p as ProfileRow]))

    const ncrMap = new Map(all.map(n => [n.id, n]))

    // ── Digest email to quality managers ──────────────────────────────────
    const { data: qms } = await db
      .from('profiles')
      .select('email')
      .eq('role', 'quality_manager')
      .eq('active', true)
    const qmEmails = (qms ?? []).map((p: any) => p.email as string).filter(Boolean)

    if (qmEmails.length) {
      let digestHtml = `<h2 style="${S.h2}">NCR daily digest</h2>`
      digestHtml += ncrTable(overdue, 'Overdue — open more than 30 days')
      digestHtml += ncrTable(stalled, 'Stalled — no containment or no root cause')

      if (actions.length) {
        digestHtml += `<h3 style="${S.h3}">Corrective actions past due date
            <span style="font-weight:400;color:#46587a">${actions.length}</span></h3>
          <table style="${S.table}">
            <thead><tr>
              <th style="${S.th}">NCR</th><th style="${S.th}">Action</th>
              <th style="${S.th}">Owner</th><th style="${S.th}">Due</th>
            </tr></thead>
            <tbody>${actions.map(a => {
              const owner = a.owner_id ? ownerMap.get(a.owner_id) : undefined
              const ncr   = ncrMap.get(a.ncr_id)
              return `<tr>
                <td style="${S.td}"><b>${esc(ncr?.ref ?? '—')}</b></td>
                <td style="${S.td}">${esc(a.action)}</td>
                <td style="${S.td}">${esc(owner?.full_name ?? '—')}</td>
                <td style="${S.td}">${esc(a.due_date)}</td>
              </tr>`
            }).join('')}</tbody>
          </table>`
      }

      await send(
        qmEmails,
        `[NCR] Daily digest · ${overdue.length} overdue · ${stalled.length} stalled · ${actions.length} past due`,
        wrap(digestHtml),
      )
    }

    // ── Personal emails to action owners ─────────────────────────────────
    const byOwner = new Map<string, { email: string; name: string; actions: ActionRow[] }>()
    for (const a of actions) {
      if (!a.owner_id) continue
      const owner = ownerMap.get(a.owner_id)
      if (!owner?.email) continue
      if (!byOwner.has(a.owner_id))
        byOwner.set(a.owner_id, { email: owner.email, name: owner.full_name, actions: [] })
      byOwner.get(a.owner_id)!.actions.push(a)
    }

    for (const { email, actions: ownerActions } of byOwner.values()) {
      const count = ownerActions.length
      const personalHtml = wrap(`
        <h2 style="${S.h2}">Corrective action${count > 1 ? 's' : ''} overdue</h2>
        <p>${esc(count === 1
          ? 'A corrective action assigned to you is past its due date.'
          : `${count} corrective actions assigned to you are past their due date.`)}</p>
        <table style="${S.table}">
          <thead><tr>
            <th style="${S.th}">NCR</th><th style="${S.th}">Action</th><th style="${S.th}">Due</th>
          </tr></thead>
          <tbody>${ownerActions.map(a => {
            const ncr = ncrMap.get(a.ncr_id)
            return `<tr>
              <td style="${S.td}"><b>${esc(ncr?.ref ?? '—')}</b></td>
              <td style="${S.td}">${esc(a.action)}</td>
              <td style="${S.td}">${esc(a.due_date)}</td>
            </tr>`
          }).join('')}</tbody>
        </table>
      `)
      await send(
        [email],
        `[NCR Action] You have ${count} overdue corrective action${count > 1 ? 's' : ''}`,
        personalHtml,
      )
    }

    return new Response(
      JSON.stringify({
        digest: qmEmails.length,
        personal: byOwner.size,
        overdue: overdue.length,
        stalled: stalled.length,
        actions: actions.length,
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }

  return new Response(JSON.stringify({ error: 'Unknown type' }), { status: 400 })
})
