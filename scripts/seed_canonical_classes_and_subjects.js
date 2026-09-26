globalThis.WebSocket = require("ws");
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");

// Read .env.local
const env = fs.readFileSync(".env.local", "utf8");
let url, key;
env.split("\n").forEach((l) => {
  if (l.startsWith("NEXT_PUBLIC_SUPABASE_URL=")) url = l.split("=")[1].trim();
  if (l.startsWith("SUPABASE_SERVICE_ROLE_KEY=")) key = l.split("=")[1].trim();
});

if (!url || !key) {
  console.error("Missing Supabase credentials in .env.local");
  process.exit(1);
}

const supabase = createClient(url, key);

const classesToSeed = [
  { name: "JSS 1", level: "junior", display_order: 1 },
  { name: "JSS 2", level: "junior", display_order: 2 },
  { name: "JSS 3", level: "junior", display_order: 3 },
  { name: "SSS 1 Science", level: "senior", display_order: 4 },
  { name: "SSS 1 Arts", level: "senior", display_order: 5 },
  { name: "SSS 1 Commercial", level: "senior", display_order: 6 },
  { name: "SSS 2 Science", level: "senior", display_order: 7 },
  { name: "SSS 2 Arts", level: "senior", display_order: 8 },
  { name: "SSS 2 Commercial", level: "senior", display_order: 9 },
  { name: "SSS 3 Science", level: "senior", display_order: 10 },
  { name: "SSS 3 Arts", level: "senior", display_order: 11 },
  { name: "SSS 3 Commercial", level: "senior", display_order: 12 },
];

const subjectsToSeed = [
  // Junior Only
  { name: "Business Studies", code: "BST", level: "junior", periods_per_week: 2 },
  { name: "Christian Religious Studies", code: "CRS-J", level: "junior", periods_per_week: 3 },
  { name: "Cultural and Creative Art", code: "CCA", level: "junior", periods_per_week: 2 },
  { name: "English Language", code: "ENG-J", level: "junior", periods_per_week: 5 },
  { name: "History", code: "HIS", level: "junior", periods_per_week: 2 },
  { name: "Intermediate Science", code: "ISC", level: "junior", periods_per_week: 4 },
  { name: "Physical and Health Education", code: "PHE", level: "junior", periods_per_week: 2 },
  { name: "Social and Citizenship Studies", code: "SCS", level: "junior", periods_per_week: 3 },

  // Senior Only
  { name: "Account", code: "ACC", level: "senior", periods_per_week: 4 },
  { name: "Agric", code: "AGR", level: "senior", periods_per_week: 3 },
  { name: "Biology", code: "BIO", level: "senior", periods_per_week: 4 },
  { name: "Chemistry", code: "CHE", level: "senior", periods_per_week: 4 },
  { name: "Citizenship", code: "CIT", level: "senior", periods_per_week: 3 },
  { name: "Commerce", code: "COM", level: "senior", periods_per_week: 4 },
  { name: "CRS", code: "CRS-S", level: "senior", periods_per_week: 4 },
  { name: "Economics", code: "ECN", level: "senior", periods_per_week: 3 },
  { name: "English", code: "ENG-S", level: "senior", periods_per_week: 5 },
  { name: "Further Math", code: "FMT", level: "senior", periods_per_week: 3 },
  { name: "Government", code: "GOV", level: "senior", periods_per_week: 4 },
  { name: "Literature", code: "LIT", level: "senior", periods_per_week: 4 },
  { name: "Marketing", code: "MKT", level: "senior", periods_per_week: 3 },
  { name: "Physics", code: "PHY", level: "senior", periods_per_week: 4 },
  { name: "Technical Drawing", code: "TD", level: "senior", periods_per_week: 3 },

  // Cross-level / Both
  { name: "Mathematics", code: "MTH", level: "both", periods_per_week: 6 },
  { name: "Digital Technology", code: "DTC", level: "both", periods_per_week: 3 },
  { name: "Trade", code: "TRD", level: "both", periods_per_week: 2 },
  { name: "Yoruba", code: "YOR", level: "both", periods_per_week: 3 },
];

async function seed() {
  console.log("=== SEEDING CANONICAL CLASSES AND SUBJECTS ===");

  // 1. Seed Classes
  console.log(`\nSeeding ${classesToSeed.length} classes...`);
  const { data: seededClasses, error: classErr } = await supabase
    .from("classes")
    .upsert(classesToSeed, { onConflict: "name" })
    .select();

  if (classErr) {
    console.error("Error seeding classes:", classErr);
    process.exit(1);
  }
  console.log(`Successfully seeded ${seededClasses.length} classes!`);

  // 2. Seed Subjects
  console.log(`\nSeeding ${subjectsToSeed.length} subjects...`);
  const { data: seededSubjects, error: subErr } = await supabase
    .from("subjects")
    .upsert(subjectsToSeed, { onConflict: "name" })
    .select();

  if (subErr) {
    console.error("Error seeding subjects:", subErr);
    process.exit(1);
  }
  console.log(`Successfully seeded ${seededSubjects.length} subjects!`);

  // 3. Verify Final Totals
  const { count: finalClassCount } = await supabase
    .from("classes")
    .select("*", { count: "exact", head: true });

  const { count: finalSubjectCount } = await supabase
    .from("subjects")
    .select("*", { count: "exact", head: true });

  console.log(`\n=== VERIFICATION ===`);
  console.log(`Classes count in DB: ${finalClassCount}`);
  console.log(`Subjects count in DB: ${finalSubjectCount}`);
}

seed().catch(console.error);
