/**
 * Gracemark Academy Curriculum Management
 * Exact Junior & Senior Secondary School Subjects
 */

// 12 Junior Class Subjects
export const STANDARD_JSS_SUBJECTS = [
  "Business Studies",
  "Christian Religious Studies",
  "Cultural and Creative Art",
  "Digital Technology",
  "English Language",
  "History",
  "Intermediate Science",
  "Mathematics",
  "Physical and Health Education",
  "Social and Citizenship Studies",
  "Trade",
  "Yoruba",
];

// 19 Senior Class Subjects
export const STANDARD_SSS_SUBJECTS = [
  "Mathematics",
  "English",
  "Chemistry",
  "Physics",
  "Biology",
  "Government",
  "Literature",
  "Account",
  "Commerce",
  "CRS",
  "Economics",
  "Further Math",
  "Trade",
  "Digital Technology",
  "Agric",
  "Technical Drawing",
  "Yoruba",
  "Marketing",
  "Citizenship",
];

export const SSS_CORE_SUBJECTS = [
  "Mathematics",
  "English",
  "Economics",
  "Citizenship",
  "Trade",
  "Digital Technology",
];

export const SSS_SCIENCE_MAJORS = [
  "Chemistry",
  "Physics",
  "Biology",
  "Agric",
];

export const SSS_SCIENCE_ELECTIVES = [
  "Further Math",
  "Technical Drawing",
  "Yoruba",
];

export const SSS_ARTS_MAJORS = [
  "Literature",
  "Government",
  "CRS",
  "Yoruba",
];

export const SSS_ARTS_ELECTIVES = [
  "Agric",
  "Marketing",
];

export const SSS_COMMERCIAL_MAJORS = [
  "Account",
  "Commerce",
  "Marketing",
];

export const SSS_COMMERCIAL_ELECTIVES = [
  "Government",
  "Agric",
  "Yoruba",
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
    electives: ["Agric", "Marketing", "Further Math"],
  };
}
