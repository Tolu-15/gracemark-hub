const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");
globalThis.WebSocket = require("ws");

// Read env
const env = fs.readFileSync(".env.local", "utf8");
let url, key;
env.split("\n").forEach((l) => {
  if (l.startsWith("NEXT_PUBLIC_SUPABASE_URL=")) url = l.split("=")[1].trim();
  if (l.startsWith("SUPABASE_SERVICE_ROLE_KEY=")) key = l.split("=")[1].trim();
});

const supabase = createClient(url, key);

async function seedAdmin() {
  const authId = "7eb7db1b-940b-43b2-9fa4-0f52bb7d0273";
  const email = "toluwanimibabalola2707@gmail.com";
  const displayName = "Toluwanimi Babalola";

  console.log("Seeding admin user into public.users...");
  const { data, error } = await supabase
    .from("users")
    .upsert(
      {
        auth_id: authId,
        email: email,
        display_name: displayName,
        role: "admin",
        status: "active",
        must_change_password: false,
      },
      { onConflict: "auth_id" }
    )
    .select()
    .single();

  if (error) {
    console.error("Error upserting admin user:", error);
  } else {
    console.log("SUCCESS! Admin user seeded:", data);
  }
}

seedAdmin();
