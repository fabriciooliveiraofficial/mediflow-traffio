
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://fyyhxmugxcfqhvoevuwf.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ5eWh4bXVneGNmcWh2b2V2dXdmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA3NTk0MDIsImV4cCI6MjA4NjMzNTQwMn0.4P_7_DpEFS51QcsyWk0s0DLUqPZEXA7NJf4sAy6jqrg'

const supabase = createClient(supabaseUrl, supabaseKey)

const email = 'fabriciooliveiraofficial@gmail.com'
const password = 'Fdm399788896528168172@#$'

async function testLogin() {
    console.log(`Testing login for: ${email}`)

    const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
    })

    if (error) {
        console.error('Login FAILED:', error.message)
    } else {
        console.log('Login SUCCESS!')
        console.log('User ID:', data.user.id)
        console.log('Role:', data.user.role)
    }
}

testLogin()
