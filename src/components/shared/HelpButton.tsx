"use client";

import React, { useState } from "react";

type Role = "admin" | "teacher" | "student";
interface Guide {
  q: string;
  a: React.ReactNode;
}

const COMMON: Guide[] = [
  {
    q: "I forgot my password",
    a: "Tell your class teacher or the school office. They can reset it to the school's starting password, and you will be asked to choose a new one when you sign in.",
  },
  {
    q: "The page looks stuck or old",
    a: "Refresh the page. If it still looks wrong, sign out, close the tab and sign in again. If the school is updating the portal you will see a message saying so.",
  },
];

const GUIDES: Record<Role, Guide[]> = {
  student: [
    {
      q: "How do I sign in?",
      a: "Open the portal, type your admission number and your password, then press Sign in. The first time, you will be asked to choose your own password. Pick one only you know.",
    },
    {
      q: "How do I change my password?",
      a: (
        <>
          Open <strong>Change Password</strong> in the menu (under Account), type your current password, then the new one twice, and save. A new password cannot be a simple school password such as &ldquo;gracemark&rdquo;.
        </>
      ),
    },
    {
      q: "How do I see my results?",
      a: (
        <>
          Open <strong>Results Dashboard</strong> and choose the <strong>term</strong> and <strong>session</strong>. Each report the school has published shows as a tab: PR 1, PR 2, PR 3 and Terminal. Progress reports are free to view. Only results the school has released appear.
        </>
      ),
    },
    {
      q: "The Terminal result asks for a scratch card",
      a: (
        <>
          The Terminal Result needs a scratch card for that term. Buy one at the school office (you get a PIN) or pay online if the button is shown. Type the PIN in the box and press <strong>Activate</strong>, then press <strong>View terminal result</strong> and confirm. Opening the result uses one view; printing from the open page does not use another. If you refresh or leave the page, opening it again uses another view.
        </>
      ),
    },
    {
      q: "How do I print or save my result?",
      a: "Open the report and press Print. Choose “Save as PDF” as the printer to keep a copy on your phone or computer.",
    },
    {
      q: "What is the Performance summary?",
      a: "Under each report there is a written summary built from your own marks: subjects where you are strongest and weakest, how you compare with the class, your position (on the terminal result), attendance, personal skills, and what to work on next. Read it with your parent or class teacher.",
    },
  ],
  teacher: [
    {
      q: "How do I enter scores?",
      a: (
        <>
          Open <strong>Score Entry</strong>, choose the class, subject and term, and type the marks. Your work is saved as a draft automatically. When every student is done, press <strong>Submit to Admin</strong>.
        </>
      ),
    },
    {
      q: "What does “returned” mean?",
      a: "The admin sent that subject back with a message about what to correct. Fix it and press Submit to Admin again. Your dashboard lists returned subjects.",
    },
    {
      q: "How do I mark attendance?",
      a: "Open Attendance, choose your class and the date, tick who was present for morning and afternoon, and save.",
    },
    {
      q: "Why can't I edit an earlier term?",
      a: "Only the current term is open for teachers. If a correction is needed in an earlier term, ask the admin to unlock it.",
    },
    {
      q: "How do I change my password?",
      a: "Open Change Password in the menu, enter the current and the new password, and save.",
    },
  ],
  admin: [
    {
      q: "How do results go from teachers to students?",
      a: (
        <>
          Teachers submit their sheets. In <strong>Result Approvals</strong> you review and approve them (or return them with a note), then publish the progress reports and the Terminal Result for each class. <strong>Late Score Sheets</strong> shows who has not finished and can remind them.
        </>
      ),
    },
    {
      q: "How do I start a new term?",
      a: "Use Term Setup. It checks the old term is finished, saves the resumption date and school days, locks the old term for teachers and switches to the next.",
    },
    {
      q: "How do I give a student their login?",
      a: "Student Logins lists who has never signed in and prints login slips. For one student, use Manage Students.",
    },
    {
      q: "How do scratch cards work?",
      a: "In Scratch Cards, issue a PIN card for a student (paid at the office or free). Parents can also buy online when the developer has turned it on. Sales and revoking are there too.",
    },
    {
      q: "How do I handle an admission application?",
      a: "Applicants shows paid applications. Review, approve or reject (the parent is emailed), then Enrol with the admission number you choose to create the student, login and class place.",
    },
  ],
};

/** A small "?" button that opens plain-language guides for the signed-in role. */
export default function HelpButton({ role }: { role: Role }) {
  const [open, setOpen] = useState(false);
  const guides = [...GUIDES[role], ...COMMON];
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Help"
        aria-label="Help"
        className="print:hidden w-8 h-8 rounded-full border text-sm font-bold flex items-center justify-center cursor-pointer shrink-0 opacity-80 hover:opacity-100"
        style={{ borderColor: "currentColor" }}
      >
        ?
      </button>
      {open && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-slate-900/50 p-0 sm:p-4 print:hidden" onClick={() => setOpen(false)}>
          <div role="dialog" aria-label="Help" onClick={(e) => e.stopPropagation()} className="w-full sm:max-w-lg max-h-[85vh] overflow-y-auto bg-white text-slate-800 rounded-t-2xl sm:rounded-2xl shadow-xl border border-slate-200">
            <div className="sticky top-0 bg-white px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-900">How to use the portal</h2>
              <button type="button" onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-700 text-xl leading-none cursor-pointer" aria-label="Close help">
                &times;
              </button>
            </div>
            <div className="p-3 space-y-2">
              {guides.map((g) => (
                <details key={g.q} className="group rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <summary className="cursor-pointer text-sm font-semibold text-slate-900 list-none flex items-center justify-between gap-2">
                    {g.q}
                    <span className="text-slate-400 group-open:rotate-45 transition-transform text-lg leading-none">+</span>
                  </summary>
                  <div className="mt-2 text-sm text-slate-600 leading-relaxed">{g.a}</div>
                </details>
              ))}
              <p className="text-[11px] text-slate-400 px-1 pt-2">Still stuck? Ask your class teacher or visit the school office.</p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
