/* Test configuration. Points nowhere: the mock client never makes a
   request, and if a real one ever slips into a suite it will fail loudly
   against this hostname rather than quietly hitting a live project. */
window.QGRID_CONFIG = {
  url: 'https://never.invalid',
  key: 'test-anon-key',
  division: { code: 'MVS', name: 'ACTOM MV Switchgear' },
  build: { commit: 'test0000', deployedAt: '', context: 'local' }
};
