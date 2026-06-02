
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.VITE_SUPABASE_ANON_KEY!
);

async function testRpc() {
  console.log('Testing find_next_available_dates...');
  const { data, error } = await supabase.rpc('find_next_available_dates', {
    p_doctor_id: '99026416-86d1-422a-8d69-a86d2524a107', // Fabricio's ID from subagent logs
    p_location_id: '15967ee3-f119-482f-8700-111111111111', // Dummy or find one
    p_duration_minutes: 30,
    p_limit: 1,
    p_from_date: '2026-04-09'
  });

  if (error) {
    console.error('RPC Error:', error);
  } else {
    console.log('RPC Success:', data);
  }
}

testRpc();
