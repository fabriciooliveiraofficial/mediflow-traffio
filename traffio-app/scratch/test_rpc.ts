import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.VITE_SUPABASE_ANON_KEY!
);

async function checkAvailability() {
  // Query doctor_availability using a simple select.
  // Wait, since we are not authenticated in this script (unless we sign in),
  // let's sign in first to ensure we can bypass RLS for our own query,
  // or we can see if RLS allows reading it. Let's sign in to be safe.
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: 'test-agent-1780516321129@example.com',
    password: 'Password123!',
  });

  if (authError) {
    console.error('Sign-in failed:', authError.message);
    return;
  }

  // Query doctor_availability for all doctors
  const { data: availabilities, error } = await supabase
    .from('doctor_availability')
    .select('*, locations(name)')
    .order('doctor_id');

  if (error) {
    console.error('Error fetching doctor availability:', error);
  } else {
    console.log(`Found ${availabilities?.length || 0} availability records:`);
    console.log(JSON.stringify(availabilities, null, 2));
  }
}

checkAvailability();
