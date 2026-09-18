/**
 * App route map — HTML paths relative to the `public/` folder.
 * Used by server.js (local dev) and firebase.json (hosting rewrites).
 */
module.exports = {
  login: "/",
  pages: {
    "/": "index.html",
    "/admin/": "admin.html",
    "/teacher/": "teacher.html",
    "/student/": "student.html",
    "/admin/dashboard/": "admin/dashboard/index.html",
    "/admin/teachers/": "admin/teachers/index.html",
    "/admin/students/": "admin/students/index.html",
    "/admin/approvals/": "admin/approvals/index.html",
    "/admin/remarks/": "admin/remarks/index.html",
    "/admin/exams/": "admin/exams/index.html",
    "/admin/promotions/": "admin/promotions/index.html",
    "/teacher/dashboard/": "teacher/dashboard/index.html",
    "/teacher/gradebook/": "teacher/gradebook/index.html",
    "/teacher/score-entry/": "teacher/score-entry/index.html",
    "/teacher/attendance/": "teacher/attendance/index.html",
    "/teacher/assessments/": "teacher/assessments/index.html",
    "/teacher/remarks/": "teacher/remarks/index.html",
    "/student/dashboard/": "student/dashboard/index.html",
    "/student/assessments/": "student/assessments/index.html",
    "/student/profile/": "student/profile/index.html",
    "/student/result/": "student/result/index.html",
    "/admission-form/": "admission-form/index.html",
    "/form/": "form.html",
    "/admin/forms/": "admin/forms/index.html",

    // Finance & Fee Management Routes
    "/admin/finance/fees/": "admin/finance/fees/index.html",
    "/admin/finance/payments/": "admin/finance/payments/index.html",
    "/admin/finance/reports/": "admin/finance/reports/index.html",
    "/admin/students/payment-status/": "admin/students/payment-status/index.html",
    "/admin/students/access/": "admin/students/access/index.html",
    "/admin/admissions/forms/": "admin/admissions/forms/index.html",
    "/admin/admissions/applicants/": "admin/admissions/applicants/index.html",
    "/admin/settings/portal-access/": "admin/settings/portal-access/index.html",

    // Student School Fees & Payment Portal Routes
    "/student/school-fees/": "student/school-fees/index.html",
    "/student/payment-history/": "student/payment-history/index.html",
    "/student/receipts/": "student/receipts/index.html",
    "/student/financial-report/": "student/financial-report/index.html",
    "/student/locked/": "student/locked/index.html",
  },
};
