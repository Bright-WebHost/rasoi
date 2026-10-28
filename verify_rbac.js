const { createClient } = require('@supabase/supabase-js');

const dotenv = require('dotenv');

dotenv.config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
// The next.js dev server is running on 3000
const NEXT_URL = 'http://localhost:3000';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false
  }
});

const USERS = {
  admin: { email: 'admin@pabbas.com', password: 'password123' },
  counter: { email: 'counter@pabbas.com', password: 'password123' },
  kitchen: { email: 'kitchen@pabbas.com', password: 'password123' },
  waiter: { email: 'waiter@pabbas.com', password: 'password123' }
};

const ALL_ROUTES = [
  '/dashboard',          // mapped to /dashboard/orders
  '/dashboard/kitchen',
  '/dashboard/pos',
  '/dashboard/tables',
  '/dashboard/riders',
  '/dashboard/menu',
  '/dashboard/chat',
  '/dashboard/stats',
];

async function testRbac() {
  console.log('--- STARTING RBAC VERIFICATION AGAINST NEXT.JS SERVER ---');

  for (const [role, data] of Object.entries(USERS)) {
    console.log(`\n\n[Testing Role: ${role.toUpperCase()}]`);
    
    // 1. Sign In to get the token
    const { data: authData, error } = await supabase.auth.signInWithPassword({
      email: data.email,
      password: data.password,
    });

    if (error || !authData.session) {
      console.log(`❌ Failed to login as ${role}: ${error?.message || 'No session'}`);
      continue;
    }

    const session = authData.session;
    
    // Construct the cookie that Next.js supabase SSR client expects.
    const projectId = SUPABASE_URL.match(/https:\/\/(.*?).supabase.co/)[1];
    
    // Use the raw token since `@supabase/ssr` resolves 'sb-...-auth-token'
    const cookieStr = `sb-${projectId}-auth-token=${encodeURIComponent(JSON.stringify([session.access_token, session.refresh_token, null, null, null]))}`;

    for (const route of ALL_ROUTES) {
      try {
        const res = await fetch(`${NEXT_URL}${route}`, {
          method: 'GET',
          headers: {
            'Cookie': cookieStr,
            'User-Agent': 'RBAC-Tester'
          },
          redirect: 'manual' // Catch the redirect!
        });

        if (res.status === 200) {
          console.log(`✅ ${route} -> Allowed (HTTP ${res.status})`);
        } else if (res.status === 307 || res.status === 308) {
          const loc = res.headers.get('location');
          if (loc === '/' || loc === 'http://localhost:3000/') {
            console.log(`🔴 ${route} -> Blocked (Redirected to /)`);
          } else {
            console.log(`⚠️ ${route} -> Redirected to ${loc}`);
          }
        } else {
          console.log(`❓ ${route} -> HTTP ${res.status}`);
        }
      } catch (err) {
        console.log(`⚠️ Failed to fetch ${route}: ${err.message}`);
      }
    }
  }
}

testRbac();
