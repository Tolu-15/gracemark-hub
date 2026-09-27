export interface RawScores {
  cw: (number | string)[];
  hw: (number | string)[];
  tests: (number | string)[];
  project: number | string;
  exam: number | string;
}

export interface ScoreValidationIssue {
  field: string;
  index: number;
  value: any;
  max: number;
}

export interface ValidationResult {
  valid: boolean;
  issues: ScoreValidationIssue[];
}

export interface GradeRemark {
  grade: string;
  remark: string;
}

export interface PRCheckpointResult {
  interval: "pr1" | "pr2" | "pr3";
  label: string;
  cw: number;
  hw: number;
  test: number;
  totalCA: number;
  percentage: number;
  grade: string;
  remark: string;
  hasData: boolean;
}

export interface TRResult {
  scaled: {
    cw: number;
    hw: number;
    tests: number;
    project: number;
    exam: number;
  };
  caTotal: number;
  totalScore: number;
  grade: string;
  remark: string;
  hasData: boolean;
}

export interface ScoreBreakdown {
  cw: (number | string)[];
  hw: (number | string)[];
  tests: (number | string)[];
  project: number | string;
  exam: number | string;
}

export interface StoredResultScores {
  cw: number;
  hw: number;
  test: number;
  project: number;
  exam: number;
  total: number;
  grade: string;
  remark: string;
  score_breakdown: ScoreBreakdown;
}

export interface SubjectBenchmark {
  avg: number;
  lowest: number;
  highest: number;
  count: number;
}
