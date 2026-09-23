/**
 * Gracemark Academy Curriculum Management
 * Exact Junior & Senior Secondary School Subjects
 */

// 12 Junior Class Subjects (Official order & periods)
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

export const JSS_SUBJECT_PERIODS: Record<string, number> = {
  "Business Studies": 2,
  "Christian Religious Studies": 3,
  "Cultural and Creative Art": 2,
  "Digital Technology": 3,
  "English Language": 5,
  "History": 2,
  "Intermediate Science": 4,
  "Mathematics": 6,
  "Physical and Health Education": 2,
  "Social and Citizenship Studies": 3,
  "Trade": 2,
  "Yoruba": 3,
};

// 19 Senior Class Subjects (Official order & periods)
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

export const SSS_SUBJECT_PERIODS: Record<string, number> = {
  "Mathematics": 6,
  "English": 5,
  "Chemistry": 4,
  "Physics": 4,
  "Biology": 4,
  "Government": 4,
  "Literature": 4,
  "Account": 4,
  "Commerce": 4,
  "CRS": 4,
  "Economics": 3,
  "Further Math": 3,
  "Trade": 2,
  "Digital Technology": 3,
  "Agric": 3,
  "Technical Drawing": 3,
  "Yoruba": 3,
  "Marketing": 3,
  "Citizenship": 3,
};

export type SubjectLevel = "junior" | "senior" | "both";

/**
 * Determines whether a subject belongs to Junior (JSS), Senior (SSS), or Both.
 */
export function getSubjectLevel(name: string): SubjectLevel {
  const clean = name.trim().toLowerCase();
  const inJss = STANDARD_JSS_SUBJECTS.some((s) => s.toLowerCase() === clean);
  const inSss = STANDARD_SSS_SUBJECTS.some((s) => s.toLowerCase() === clean);

  if (inJss && inSss) return "both";
  if (inJss) return "junior";
  if (inSss) return "senior";
  return "both";
}

/**
 * Gets the official curriculum weekly periods for a given subject.
 */
export function getSubjectPeriods(name: string, level?: "junior" | "senior"): number | null {
  const clean = name.trim();
  if (level === "junior" || (!level && JSS_SUBJECT_PERIODS[clean])) {
    return JSS_SUBJECT_PERIODS[clean] || null;
  }
  if (level === "senior" || (!level && SSS_SUBJECT_PERIODS[clean])) {
    return SSS_SUBJECT_PERIODS[clean] || null;
  }
  return null;
}

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
