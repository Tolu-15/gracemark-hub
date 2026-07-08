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
    "/teacher/dashboard/": "teacher/dashboard/index.html",
    "/teacher/gradebook/": "teacher/gradebook/index.html",
    "/teacher/score-entry/": "teacher/score-entry/index.html",
    "/student/dashboard/": "student/dashboard/index.html",
  },
};
