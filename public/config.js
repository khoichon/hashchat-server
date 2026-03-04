// HashChat config — update these with your actual values
const SUPABASE_URL  = 'https://digtgktzyxonguxhhdri.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRpZ3Rna3R6eXhvbmd1eGhoZHJpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0NDkzNzksImV4cCI6MjA4ODAyNTM3OX0.YYSwTR1Ns_zs7n5Brp6qTGZ1MYD_avfseMi1aGRcHGc';
const SERVER_URL    = '';  // empty string = same origin (works on Render)

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
