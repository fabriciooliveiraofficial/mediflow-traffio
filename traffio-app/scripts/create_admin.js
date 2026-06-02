
import { createClient } from '@supabase/supabase-js'

// Hardcoded for this one-off script execution to avoid missing dependencies
const supabaseUrl = 'https://fyyhxmugxcfqhvoevuwf.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ5eWh4bXVneGNmcWh2b2V2dXdmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA3NTk0MDIsImV4cCI6MjA4NjMzNTQwMn0.4P_7_DpEFS51QcsyWk0s0DLUqPZEXA7NJf4sAy6jqrg'

const supabase = createClient(supabaseUrl, supabaseKey)

const email = 'fabriciooliveiraofficial@gmail.com'
const password = 'Fdm399788896528168172@#$'

async function createAdmin() {
    console.log(`Attempting to create admin user: ${email}`)

    // 1. Try to Sign Up
    const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
            data: {
                full_name: 'Super Admin',
            }
        }
    })

    if (error) {
        console.error('Error creating user:', error.message)

        if (error.message.includes('already registered')) {
            console.log('User already exists. Trying to sign in...')
            const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
                email,
                password
            })

            if (signInError) {
                console.error('Login failed:', signInError.message)
                console.log('SUGGESTION: Run the CLEANUP SQL script to remove the broken user record, then run this script again.')
            } else {
                console.log('Login successful! User is valid.')
                console.log('User ID:', signInData.user.id)
                // Now we would manually need to set the role in SQL
                console.log('IMPORTANT: Now run the SQL command to set the role:')
                console.log(`UPDATE public.profiles SET role = 'super_admin' WHERE id = '${signInData.user.id}';`)
            }
        }
        return
    }

    if (data.user) {
        console.log('User created successfully!')
        console.log('User ID:', data.user.id)
        console.log('IMPORTANT: Now run the SQL command to set the role:')
        console.log(`UPDATE public.profiles SET role = 'super_admin' WHERE id = '${data.user.id}';`)
    }
}

createAdmin()
