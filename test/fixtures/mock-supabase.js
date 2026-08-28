/* =====================================================================
   In-memory stand-in for vendor/supabase.js.

   Exposes the same surface the real bundle does — window.supabase with a
   createClient factory — so shared/supabase.js and app.js load unchanged
   and the suites exercise the deployed code paths, not a special test
   build. Every call is recorded on window.GRID_CALLS so a suite can assert
   what the app actually asked the database to do.
   ===================================================================== */
(function () {
  /* Stands in for lib/supabase.js so app.js can be exercised without a network. */
  const DIVISION = { code: "MVS", name: "ACTOM MV Switchgear" };
  const BUILD = { commit: "abc1234", deployedAt: "now", context: "test" };

  const REV_DEF = { sections: [
    { id:"s1", title:"Identification", items:[
      { id:"i1", type:"serial", label:"Panel serial", req:1 },
      { id:"i2", type:"info", label:"Work to WI-MV-14 rev 3." }]},
    { id:"s2", title:"Mechanical", items:[
      { id:"i3", type:"measure", label:"Busbar torque", unit:"Nm", tgt:"70", min:"66", max:"74", req:1, ncr:1, dfc:"DF020", hold:1 },
      { id:"i4", type:"passfail", label:"Earth switch operates", req:1, ncr:1, dfc:"DF020" },
      { id:"i5", type:"instr", label:"Torque wrench used", req:1, cat:"Torque" },
      { id:"i6", type:"select", label:"Panel type", opts:["Incomer","Feeder"] },
      { id:"i7", type:"photo", label:"Photo of assembly", minp:2 },
      { id:"i8", type:"sign", label:"Inspector signature", req:1 }]}]};

  const DATA = {
    division_profile: { id:true, code:"MVS", name:"ACTOM MV Switchgear", hold_points:false, require_second_approver:false },
    manufacturing_stages: [{id:1,name:"Assembly",sort_order:5,active:true},{id:2,name:"Wiring",sort_order:6,active:true}],
    departments: [{id:1,name:"Assembly",stage_id:1,sort_order:5},{id:2,name:"Wiring",stage_id:2,sort_order:6}],
    product_families: [{id:1,name:"12 kV metal-clad",active:true},{id:2,name:"22 kV RMU",active:true}],
    defect_codes: [{id:1,code:"DF020",description:"Assembly defect",active:true}],
    equipment: [{id:1,asset_no:"MME-0517",name:"Torque wrench",category:"Torque",status:"due",active:true},
                {id:2,asset_no:"MME-0412",name:"Injection set",category:"Torque",status:"overdue",active:true}],
    inspection_templates: [{id:"t1",code:"IT-ASM-04",name:"Assembly Inspection",stage_id:1,family_id:1,min_competency:2}],
    template_revisions: [{id:"r1",template_id:"t1",rev:3,status:"published",definition:REV_DEF,created_by:"u2"},
                         {id:"r2",template_id:"t1",rev:4,status:"draft",definition:REV_DEF,created_by:"u2"}],
    inspection_requirements: [{id:1,family_id:1,stage_id:1,template_id:"t1",level:"required",sampling:"full"}],
    projects: [{id:1,code:"P-26118",name:"Eskom",family_id:1,active:true}],
    works_orders: [{id:1,code:"WO-44812",project_id:1,qty:3,status:"open"}],
    inspections: [
      {id:"n1",ref:"INS-26-1191",template_rev_id:"r1",stage_id:1,project_id:1,works_order_id:1,unit_ref:"MV-118-08",
       assigned_to:"u1",department_id:1,planned_date:"2026-08-01",status:"scheduled",result:null},
      {id:"n2",ref:"INS-26-1189",template_rev_id:"r1",stage_id:1,project_id:1,works_order_id:1,unit_ref:"MV-118-07",
       assigned_to:"u1",department_id:1,planned_date:"2026-08-20",status:"completed",result:"fail",
       completed_at:"2026-08-20T10:00:00Z",signed_by:"u1"},
      {id:"n3",ref:"INS-26-1196",template_rev_id:"r1",stage_id:1,project_id:1,works_order_id:1,unit_ref:"MV-141-04",
       assigned_to:null,department_id:1,planned_date:"2026-08-30",status:"scheduled",result:null}],
    failed_checks: [{id:"f1",ref:"FC-26-0212",inspection_id:"n2",result_id:"x1",defect_code_id:1,is_hold:false,
                     disposition:"awaiting",created_at:"2026-08-20T10:01:00Z"}],
    profiles: [{id:"u1",full_name:"Varshan Mahabel",email:"varshan.mahabel@actom.co.za",role:"quality_manager",department_id:1,active:true},
               {id:"u2",full_name:"T. Nkosi",email:"t.nkosi@actom.co.za",role:"quality_engineer",department_id:1,active:true},
               {id:"u3",full_name:"New Starter",email:"new@actom.co.za",role:"inspector",department_id:null,active:false}],
    v_dashboard: { open_inspections:2, overdue:1, unassigned:1, awaiting_disposition:1, completed_30d:1, pass_rate_30d:0 },
    v_stage_yield: [{stage:"Assembly",inspections:1,passed:0,pass_rate:0}],
    competencies: [
    { id:1, profile_id:"u1", skill:"Routine testing sign-off", level:3, valid_to:null },
    { id:2, profile_id:"u2", skill:"Visual and dimensional inspection", level:2, valid_to:null }
  ],
  inspection_results: [],
    audit_trail: [{at:"2026-08-26T09:00:00Z",actor_name:"Varshan Mahabel",action:"insert",entity:"inspections",entity_id:"n1abcdef"}]
  };

  const CALLS = [];
  function result(table) {
    const rows = DATA[table];
    return Array.isArray(rows) ? { data: rows, error: null } : { data: rows ?? null, error: null };
  }
  /* maybeSingle()/single() must hand back ONE row, not the array. The
     wrapper's currentProfile() relies on this, and so does anything that
     reads division_profile — getting it wrong here would make the app
     look broken in tests for a reason that has nothing to do with the app. */
  function one(table) {
    const rows = DATA[table];
    if (Array.isArray(rows)) return { data: rows[0] ?? null, error: null };
    return { data: rows ?? null, error: null };
  }
  function q(table) {
    const chain = {
      select() { return chain; }, eq() { return chain; }, order() { return chain; },
      limit() { return chain; }, maybeSingle() { return Promise.resolve(one(table)); },
      single() { return Promise.resolve(one(table)); },
      insert(v) { CALLS.push(["insert", table, v]); return { select: () => ({ single: () => Promise.resolve({ data: { id: "new1" }, error: null }) }), then: r => r({ error: null }) }; },
      update(v) { CALLS.push(["update", table, v]); return chain; },
      upsert(v) { CALLS.push(["upsert", table, v]); return Promise.resolve({ error: null }); },
      delete() { CALLS.push(["delete", table]); return chain; },
      then(res) { return Promise.resolve(result(table)).then(res); }
    };
    return chain;
  }
  const client = {
    from: q,
    /* The RPCs MUTATE the fixture, as the real ones mutate the database. A
       stub that only returned a canned object let the app reload and still
       see the draft sitting there, so a test could not tell a successful
       publish from a no-op — the assertion that the publish button
       disappears afterwards failed against perfectly good code. */
    rpc: function (fn, args) {
      CALLS.push(["rpc", fn, args]);
      if (fn === "publish_template_revision") {
        const rev = DATA.template_revisions.find(r => r.id === args.p_rev);
        if (!rev) return Promise.resolve({ data: null, error: { message: "PUBLISH_MISSING" } });
        DATA.template_revisions.forEach(r => {
          if (r.template_id === rev.template_id && r.status === "published") r.status = "superseded";
        });
        rev.status = "published"; rev.approved_by = "u1";
        return Promise.resolve({ data: { template_id: rev.template_id, rev: rev.rev,
          status: "published", self_approved: rev.created_by === "u1" }, error: null });
      }
      if (fn === "submit_inspection") {
        const insp = DATA.inspections.find(i => i.id === args.p_inspection);
        if (insp) { insp.status = "completed"; insp.result = "fail"; insp.signed_by = "u1";
                    insp.signed_at = new Date().toISOString(); }
        return Promise.resolve({ data: { ref: insp ? insp.ref : "INS-26-1191",
          result: "fail", failed_checks: 1, works_order_held: false }, error: null });
      }
      if (fn === "generate_inspections") {
        const wo = DATA.works_orders.find(w => w.id === args.p_works_order);
        return Promise.resolve({ data: { works_order: wo ? wo.code : "WO-44812", created: 3 },
          error: null });
      }
      return Promise.resolve({ data: null, error: { message: "unknown rpc " + fn } });
    },
    /* Faithful to the real client, deliberately.

     The previous stub accepted .on() at any time and returned a fresh
     object on every channel() call, so it could not reproduce the fault
     that actually reached production: supabase.channel() returns the
     EXISTING channel for a name already in use, and .on() after
     .subscribe() throws. A stub that is more permissive than the library
     hides exactly the bugs worth catching. */
  channel: function (name) {
    CALLS.push(["channel", name]);
    if (!this._channels) this._channels = {};
    if (this._channels[name]) return this._channels[name];
    const ch = {
      name,
      subscribed: false,
      on(...a) {
        if (this.subscribed) {
          throw new Error("cannot add `postgres_changes` callbacks for realtime:" +
            this.name + " after `subscribe()`");
        }
        CALLS.push(["channel.on", this.name]);
        return this;
      },
      subscribe() { this.subscribed = true; CALLS.push(["channel.subscribe", this.name]); return this; }
    };
    this._channels[name] = ch;
    return ch;
  },
  removeChannel: function (ch) {
    CALLS.push(["removeChannel", ch && ch.name]);
    if (this._channels && ch) delete this._channels[ch.name];
    return Promise.resolve({ error: null });
  },
    auth: {
      getSession: () => Promise.resolve({ data: { session: { user: { email: "varshan.mahabel@actom.co.za", id: "u1" } } } }),
      getUser: () => Promise.resolve({ data: { user: { id: "u1" } } }),
      /* Fires the way the real client does. supabase-js emits INITIAL_SESSION
       (and SIGNED_IN when a session is restored) shortly after the listener
       is registered, which is what caused boot to run twice in production.
       A stub that never emits cannot reproduce that, so the behaviour was
       untested and only the source text was being checked. */
    onAuthStateChange: (cb) => {
      setTimeout(() => {
        try { cb("INITIAL_SESSION", { user: { id: "u1" } }); } catch (e) { CALLS.push(["authcb-threw", String(e.message)]); }
        try { cb("SIGNED_IN", { user: { id: "u1" } }); } catch (e) { CALLS.push(["authcb-threw", String(e.message)]); }
        try { cb("TOKEN_REFRESHED", { user: { id: "u1" } }); } catch (e) { CALLS.push(["authcb-threw", String(e.message)]); }
      }, 30);
      return { data: { subscription: { unsubscribe() {} } } };
    },
      signOut: () => Promise.resolve({})
    }
  };
  window.supabase = {
    createClient: function () { return client; }
  };
  window.GRID_TEST_DATA = DATA;
  window.GRID_CALLS = CALLS;
})();
