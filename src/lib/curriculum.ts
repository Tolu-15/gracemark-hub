/**
 * Gracemark Academy Curriculum Management
 * Standard WAEC/NECO/UBEC Curriculum Configurations & Subject Presets
 */

export const STANDARD_JSS_SUBJECTS = [
  "English Language",
  "Mathematics",
  "Basic Science",
  "Basic Technology",
  "Civic Education",
  "Social Studies",
  "Business Studies",
  "Physical & Health Education (PHE)",
  "Cultural & Creative Arts (CCA)",
  "Agricultural Science",
  "Home Economics",
  "Computer Studies",
  "Security Education",
  "Christian Religious Studies",
  "French",
];

export const SSS_CORE_SUBJECTS = [
  "English Language",
  "Mathematics",
  "Civic Education",
  "Economics",
];

export const SSS_SCIENCE_MAJORS = [
  "Biology",
  "Chemistry",
  "Physics",
];

export const SSS_SCIENCE_ELECTIVES = [
  "Further Mathematics",
  "Technical Drawing",
  "Agricultural Science",
  "Geography",
  "Computer Studies",
  "Food & Nutrition",
];

export const SSS_ARTS_MAJORS = [
  "Literature in English",
  "Government",
  "Christian Religious Studies",
];

export const SSS_ARTS_ELECTIVES = [
  "History",
  "Visual Arts",
  "Music",
  "French",
  "Yoruba",
  "Hausa",
  "Igbo",
  "Agricultural Science",
];

export const SSS_COMMERCIAL_MAJORS = [
  "Commerce",
  "Financial Accounting",
  "Book Keeping",
];

export const SSS_COMMERCIAL_ELECTIVES = [
  "Office Practice",
  "Marketing",
  "Store Management",
  "Government",
  "Agricultural Science",
  "Computer Studies",
];

export function isJuniorClass(className?: string): boolean {
  const c = String(className || "").trim().toUpperCase();
  return c.includes("JSS") || c.includes("JUNIOR");
}

export function getSSSTrackDefaults(className?: string): {
  core: string[];
  majors: string[];
  electives: string[];
} {
  const c = String(className || "").trim().toUpperCase();
  if (c.includes("SCI")) {
    return {
      core: SSS_CORE_SUBJECTS,
      majors: SSS_SCIENCE_MAJORS,
      electives: SSS_SCIENCE_ELECTIVES,
    };
  }
  if (c.includes("ART")) {
    return {
      core: SSS_CORE_SUBJECTS,
      majors: SSS_ARTS_MAJORS,
      electives: SSS_ARTS_ELECTIVES,
    };
  }
  if (c.includes("COMM")) {
    return {
      core: SSS_CORE_SUBJECTS,
      majors: SSS_COMMERCIAL_MAJORS,
      electives: SSS_COMMERCIAL_ELECTIVES,
    };
  }
  // Generic Senior default
  return {
    core: SSS_CORE_SUBJECTS,
    majors: ["Biology", "Government", "Commerce"],
    electives: SSS_SCIENCE_ELECTIVES,
  };
}
