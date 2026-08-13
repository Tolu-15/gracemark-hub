import { supabase } from "/supabase.js";

document.addEventListener("DOMContentLoaded", async () => {
  const authLoader = document.getElementById("authLoader");
  const formsGrid = document.getElementById("formsGrid");

  const openCreateModalBtn = document.getElementById("openCreateModalBtn");
  const createFormModal = document.getElementById("createFormModal");
  const closeCreateModalBtn = document.getElementById("closeCreateModalBtn");
  const cancelCreateModalBtn = document.getElementById("cancelCreateModalBtn");
  const createFormEl = document.getElementById("createFormEl");

  const formTitleInput = document.getElementById("formTitleInput");
  const formDescInput = document.getElementById("formDescInput");
  const formClassSelect = document.getElementById("formClassSelect");
  const formFeeInput = document.getElementById("formFeeInput");
  const addCustomFieldBtn = document.getElementById("addCustomFieldBtn");
  const customFieldsList = document.getElementById("customFieldsList");

  const qrModal = document.getElementById("qrModal");
  const closeQrModalBtn = document.getElementById("closeQrModalBtn");
  const qrcodeCanvas = document.getElementById("qrcodeCanvas");
  const qrFormUrlInput = document.getElementById("qrFormUrlInput");
  const qrModalFormTitle = document.getElementById("qrModalFormTitle");
  const copyUrlBtn = document.getElementById("copyUrlBtn");
  const openFormDirectLink = document.getElementById("openFormDirectLink");
  const downloadQrBtn = document.getElementById("downloadQrBtn");

  let classes = [];
  let customFields = [];
  let currentQrCodeObj = null;

  // 1. Auth Guard Check
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      window.location.href = "/";
      return;
    }
    const { data: userProfile } = await supabase
      .from("users")
      .select("role")
      .eq("auth_id", session.user.id)
      .maybeSingle();

    if (userProfile?.role !== "admin") {
      window.location.href = "/";
      return;
    }
    if (authLoader) authLoader.style.display = "none";
  } catch (err) {
    console.error("Auth check error:", err);
    window.location.href = "/";
    return;
  }

  // 2. Fetch Classes
  await loadClasses();
  await loadForms();

  async function loadClasses() {
    const { data } = await supabase.from("classes").select("id, name").order("name");
    classes = data || [];
    formClassSelect.innerHTML = classes.map(c => `<option value="${c.id}">${c.name}</option>`).join("");
  }

  async function loadForms() {
    formsGrid.innerHTML = `
      <div class="col-span-full text-center py-12 text-slate-400">
        <div class="w-6 h-6 border-2 border-slate-400 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
        Loading forms...
      </div>
    `;

    const { data: forms, error } = await supabase
      .from("custom_forms")
      .select("*, classes(name), form_submissions(count)")
      .order("created_at", { ascending: false });

    if (error) {
      formsGrid.innerHTML = `<div class="col-span-full text-center text-red-500 py-8">Failed to load forms: ${error.message}</div>`;
      return;
    }

    if (!forms || forms.length === 0) {
      formsGrid.innerHTML = `
        <div class="col-span-full bg-white p-12 rounded-2xl border border-slate-200 text-center space-y-3">
          <div class="w-12 h-12 bg-amber-50 text-amber-600 rounded-full flex items-center justify-center mx-auto">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
          </div>
          <h3 class="text-base font-bold text-slate-800">No Admission Forms Created Yet</h3>
          <p class="text-xs text-slate-500 max-w-sm mx-auto">Create custom registration forms for applicants, specify Paystack fees, and generate instant shareable links & downloadable QR codes.</p>
        </div>
      `;
      return;
    }

    formsGrid.innerHTML = forms.map(form => {
      const fee = Number(form.fee_amount || 0);
      const feeText = fee > 0 ? `₦${fee.toLocaleString()}` : "FREE";
      const submissionCount = form.form_submissions?.[0]?.count || 0;
      const fullUrl = `${window.location.origin}/form/?id=${form.id}`;

      return `
        <div class="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm flex flex-col justify-between space-y-4 hover:shadow-md transition">
          <div>
            <div class="flex items-start justify-between gap-2 mb-2">
              <span class="px-2.5 py-1 text-[11px] font-bold uppercase rounded-full ${fee > 0 ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}">
                Fee: ${feeText}
              </span>
              <span class="text-xs text-slate-400 font-semibold">${new Date(form.created_at).toLocaleDateString()}</span>
            </div>
            <h3 class="text-lg font-bold text-slate-900 leading-snug">${form.title}</h3>
            <p class="text-xs text-slate-500 mt-1 line-clamp-2">${form.description || "No description provided."}</p>
          </div>

          <div class="pt-3 border-t border-slate-100 flex items-center justify-between text-xs font-semibold text-slate-600">
            <span>Target: <strong class="text-slate-900">${form.classes?.name || "General"}</strong></span>
            <span>Submissions: <strong class="text-amber-600">${submissionCount}</strong></span>
          </div>

          <div class="flex items-center gap-2 pt-1">
            <button type="button" data-action="qr" data-id="${form.id}" data-title="${encodeURIComponent(form.title)}" data-url="${fullUrl}" class="flex-1 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 transition">
              <svg class="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z"/></svg>
              Share & QR Code
            </button>
            <button type="button" data-action="delete" data-id="${form.id}" class="p-2 text-red-500 hover:bg-red-50 rounded-xl transition" title="Delete Form">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
            </button>
          </div>
        </div>
      `;
    }).join("");

    // Attach Event Listeners to Buttons
    formsGrid.querySelectorAll("button[data-action='qr']").forEach(btn => {
      btn.addEventListener("click", () => {
        const title = decodeURIComponent(btn.getAttribute("data-title"));
        const url = btn.getAttribute("data-url");
        openQrModal(title, url);
      });
    });

    formsGrid.querySelectorAll("button[data-action='delete']").forEach(btn => {
      btn.addEventListener("click", async () => {
        const formId = btn.getAttribute("data-id");
        if (confirm("Are you sure you want to delete this form? Form submissions linked to it will be affected.")) {
          await supabase.from("custom_forms").delete().eq("id", formId);
          await loadForms();
        }
      });
    });
  }

  // Handle Modal Open/Close
  openCreateModalBtn.addEventListener("click", () => {
    createFormModal.classList.remove("hidden");
    customFields = [];
    renderCustomFieldsList();
  });

  const closeModal = () => createFormModal.classList.add("hidden");
  closeCreateModalBtn.addEventListener("click", closeModal);
  cancelCreateModalBtn.addEventListener("click", closeModal);

  // Dynamic Fields Builder Logic
  addCustomFieldBtn.addEventListener("click", () => {
    customFields.push({ label: "", type: "text", required: false, options: [] });
    renderCustomFieldsList();
  });

  function renderCustomFieldsList() {
    if (customFields.length === 0) {
      customFieldsList.innerHTML = `<p class="text-xs text-slate-400 italic text-center py-2">No extra custom fields added yet.</p>`;
      return;
    }

    customFieldsList.innerHTML = customFields.map((field, idx) => `
      <div class="p-2.5 bg-white border border-slate-200 rounded-lg flex flex-col gap-2">
        <div class="flex items-center gap-2">
          <input type="text" data-idx="${idx}" data-key="label" value="${field.label}" placeholder="Field Label (e.g. Parent Phone)" class="flex-1 px-2.5 py-1.5 border border-slate-300 rounded text-xs outline-none focus:border-amber-500" />
          <select data-idx="${idx}" data-key="type" class="px-2 py-1.5 border border-slate-300 rounded text-xs outline-none focus:border-amber-500 bg-white">
            <option value="text" ${field.type === 'text' ? 'selected' : ''}>Text Input</option>
            <option value="number" ${field.type === 'number' ? 'selected' : ''}>Number</option>
            <option value="textarea" ${field.type === 'textarea' ? 'selected' : ''}>Long Text</option>
            <option value="select" ${field.type === 'select' ? 'selected' : ''}>Dropdown Options</option>
          </select>
          <label class="flex items-center gap-1 text-[11px] font-semibold text-slate-600 cursor-pointer">
            <input type="checkbox" data-idx="${idx}" data-key="required" ${field.required ? 'checked' : ''} />
            Required
          </label>
          <button type="button" data-remove="${idx}" class="text-red-500 hover:text-red-700 text-xs font-bold px-1">&times;</button>
        </div>
        ${field.type === 'select' ? `
          <input type="text" data-idx="${idx}" data-key="options" value="${(field.options || []).join(', ')}" placeholder="Options separated by commas (e.g. Male, Female, Other)" class="w-full px-2 py-1 border border-slate-200 rounded text-[11px] text-slate-600 outline-none" />
        ` : ''}
      </div>
    `).join("");

    // Attach listeners
    customFieldsList.querySelectorAll("input, select").forEach(el => {
      el.addEventListener("change", (e) => {
        const idx = parseInt(el.getAttribute("data-idx"));
        const key = el.getAttribute("data-key");
        if (isNaN(idx)) return;

        if (key === "required") {
          customFields[idx].required = el.checked;
        } else if (key === "options") {
          customFields[idx].options = el.value.split(",").map(s => s.trim()).filter(Boolean);
        } else {
          customFields[idx][key] = el.value;
          if (key === "type") renderCustomFieldsList();
        }
      });
    });

    customFieldsList.querySelectorAll("button[data-remove]").forEach(btn => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.getAttribute("data-remove"));
        customFields.splice(idx, 1);
        renderCustomFieldsList();
      });
    });
  }

  // Create Form Submit
  createFormEl.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = formTitleInput.value.trim();
    const description = formDescInput.value.trim();
    const classId = formClassSelect.value;
    const feeAmount = parseFloat(formFeeInput.value) || 0;

    if (!title || !classId) {
      alert("Please fill in form title and select a class.");
      return;
    }

    const { data, error } = await supabase.from("custom_forms").insert([{
      title,
      description,
      class_id: classId,
      fee_amount: feeAmount,
      form_fields: customFields,
      is_active: true
    }]).select().single();

    if (error) {
      alert("Failed to create form: " + error.message);
      return;
    }

    closeModal();
    createFormEl.reset();
    await loadForms();

    // Open QR Code Modal immediately for newly created form
    const fullUrl = `${window.location.origin}/form/?id=${data.id}`;
    openQrModal(data.title, fullUrl);
  });

  // Open QR Modal & Generate QR Code using QRCode.js
  function openQrModal(title, url) {
    qrModalFormTitle.textContent = title;
    qrFormUrlInput.value = url;
    openFormDirectLink.href = url;

    qrcodeCanvas.innerHTML = "";

    if (typeof QRCode !== "undefined") {
      currentQrCodeObj = new QRCode(qrcodeCanvas, {
        text: url,
        width: 180,
        height: 180,
        colorDark: "#020617",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.H,
      });
    } else {
      qrcodeCanvas.innerHTML = `<p class="text-xs text-red-500">QR Code library loading failed.</p>`;
    }

    qrModal.classList.remove("hidden");
  }

  closeQrModalBtn.addEventListener("click", () => qrModal.classList.add("hidden"));

  // Copy Link
  copyUrlBtn.addEventListener("click", () => {
    qrFormUrlInput.select();
    navigator.clipboard.writeText(qrFormUrlInput.value);
    copyUrlBtn.textContent = "Copied!";
    setTimeout(() => copyUrlBtn.textContent = "Copy Link", 2000);
  });

  // Download QR Code PNG
  downloadQrBtn.addEventListener("click", () => {
    const img = qrcodeCanvas.querySelector("img") || qrcodeCanvas.querySelector("canvas");
    if (!img) return;

    let imgSrc = img.src;
    if (img.tagName.toLowerCase() === "canvas") {
      imgSrc = img.toDataURL("image/png");
    }

    const link = document.createElement("a");
    link.download = `Gracemark-Form-QR-${Date.now()}.png`;
    link.href = imgSrc;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  });
});
