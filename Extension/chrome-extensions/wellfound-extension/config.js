// Supabase Configuration
// IMPORTANT: Replace these with your actual Supabase credentials

const SUPABASE_CONFIG = {
  url: 'https://vmdbwpqopujirdcthgta.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZtZGJ3cHFvcHVqaXJkY3RoZ3RhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzEwNzAyMiwiZXhwIjoyMDgyNjgzMDIyfQ.c7QWY4J6cbVRnT9tOrw5ZcBdjzrWUZnNc_VVO1NOv00', // ⚠️ WARNING: This is a service_role key! Replace with anon key!

  // Optional: Set to false to disable auto-sync to Supabase
  autoSync: true
};

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SUPABASE_CONFIG;
}
