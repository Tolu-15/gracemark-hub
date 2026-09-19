globalThis.WebSocket = require("ws");
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");

// Read .env.local
const env = fs.readFileSync(".env.local", "utf8");
const envVars = {};
env.split("\n").forEach((line) => {
  const [k, ...v] = line.split("=");
  if (k && v.length) envVars[k.trim()] = v.join("=").trim();
});

const sb = createClient(envVars.SUPABASE_URL, envVars.SUPABASE_SERVICE_ROLE_KEY);

const comprehensiveSubjects = [
  // Core / General
  "Mathematics",
  "English Language",
  "Civic Education",
  "Computer Studies",
  "Social Studies",

  // Junior Secondary Specific
  "Basic Science",
  "Basic Technology",
  "Physical & Health Education (PHE)",
  "Cultural & Creative Arts (CCA)",
  "Home Economics",
  "Business Studies",
  "Security Education",

  // Senior Sciences
  "Biology",
  "Chemistry",
  "Physics",
  "Further Mathematics",
  "Agricultural Science",
  "Technical Drawing",
  "Geography",
  "Food & Nutrition",

  // Senior Arts & Humanities
  "Literature in English",
  "Government",
  "History",
  "Christian Religious Studies",
  "Islamic Religious Studies",
  "Visual Arts",
  "Music",
  "French",
  "Yoruba",
  "Hausa",
  "Igbo",

  // Senior Commercial
  "Economics",
  "Commerce",
  "Financial Accounting",
  "Book Keeping",
  "Office Practice",
  "Marketing",
  "Store Management",
];

async function seedSubjects() {
  console.log("Fetching existing subjects...");
  const { data: existing, error: err1 } = await sb.from("subjects").select("id, name");
  if (err1) {
    console.error("Error fetching subjects:", err1);
    return;
  }

  const existingMap = new Map();
  existing.forEach((s) => {
    existingMap.set(s.name.trim().toLowerCase(), s);
  });

  console.log(`Found ${existing.length} existing subjects.`);

  const toInsert = [];
  for (const name of comprehensiveSubjects) {
    if (!existingMap.has(name.trim().toLowerCase())) {
      toInsert.push({ name: name.trim() });
    }
  }

  if (toInsert.length === 0) {
    console.log("All comprehensive subjects already exist in the database!");
  } else {
    console.log(`Adding ${toInsert.length} new subjects to database...`);
    const { data: inserted, error: insertErr } = await sb
      .from("subjects")
      .insert(toInsert)
      .select();

    if (insertErr) {
      console.error("Error inserting subjects:", insertErr);
    } else {
      console.log(`Successfully added ${inserted.length} subjects!`);
    }
  }

  const { data: finalSubjects } = await sb.from("subjects").select("name").order("name");
  console.log(`Total subjects now in database: ${finalSubjects?.length}`);
  console.log(finalSubjects?.map((s) => s.name));
}

seedSubjects();
