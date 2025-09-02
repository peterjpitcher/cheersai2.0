import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://onvnfijtzumtnmgwhiaq.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9udm5maWp0enVtdG5tZ3doaWFxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUyMDAzMDksImV4cCI6MjA3MDc3NjMwOX0.ngwqkLZ-PMIPhxxC8TSkoSw8wjOlNr3et9xPfBi-r9Q'
);

async function testMagicLink() {
  const email = 'test@example.com'; // Change this to your test email
  
  console.log('Sending magic link to:', email);
  
  const { data, error } = await supabase.auth.signInWithOtp({
    email: email,
    options: {
      emailRedirectTo: 'https://cheersai.orangejelly.co.uk/auth/callback',
    }
  });

  if (error) {
    console.error('Error:', error);
  } else {
    console.log('Success! Check your email for the magic link');
    console.log('Response:', data);
  }
}

testMagicLink();