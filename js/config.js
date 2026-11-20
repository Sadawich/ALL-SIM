// =====================================================================
//  FLL SIM — settings. This is the only file you need to edit.
// =====================================================================
export const CONFIG = {
  siteName: 'FLL SIM',

  // SHA-256 of "fllsim:" + your admin key. Change it with the tool on the
  // Admin page ("Make a new admin key") and paste the new hash here.
  adminKeyHash: '3911a7f6736657e65581203f452c2d33ce8a52b884a029cf8f91259dc4286243',

  // ---- Optional cloud mode (Supabase, free) ----------------------------
  // Leave empty = LOCAL MODE: everything is saved in each visitor's own
  // browser, so you only see teams that registered on the same device.
  // Fill these in (see README.md) = CLOUD MODE: teams register from any
  // device and you approve/remove them, lock the site, edit the field and
  // read every team's programs from the Admin page.
  supabaseUrl: '',
  supabaseAnonKey: '',
  adminEmail: '',   // the Supabase user you log in with as admin (password = your admin key)
};
