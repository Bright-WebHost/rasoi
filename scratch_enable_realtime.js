const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function enableRealtime() {
  const { data, error } = await supabase.rpc('execute_sql', { sql: 'alter publication supabase_realtime add table orders;' });
  console.log('Result:', { data, error });
  // If rpc doesn't exist, we can't easily do it via REST. 
}

enableRealtime();
