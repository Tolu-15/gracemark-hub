import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center space-y-6 bg-slate-900/60 border border-slate-800 p-8 rounded-2xl shadow-2xl backdrop-blur-sm">
        <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center mx-auto text-2xl font-black">
          404
        </div>
        <div>
          <h1 className="text-2xl font-extrabold text-white font-serif">Page Not Found</h1>
          <p className="text-slate-400 text-sm mt-2">
            The page you are looking for doesn't exist or has been moved.
          </p>
        </div>
        <div>
          <Link
            href="/"
            className="inline-flex items-center justify-center px-6 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-sm rounded-xl transition shadow-lg shadow-amber-500/10"
          >
            Return to Portal Login
          </Link>
        </div>
      </div>
    </div>
  );
}
