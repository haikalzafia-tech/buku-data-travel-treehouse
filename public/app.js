(function () {
  "use strict";

  var entries = [];
  var editingId = null;
  var pendingPhoto = null;

  // ---- API helpers ----
  function api(path, options) {
    options = options || {};
    options.headers = Object.assign({ "Content-Type": "application/json" }, options.headers || {});
    return fetch(path, options).then(function (res) {
      if (res.status === 401) {
        window.location.href = "/login.html";
        return Promise.reject(new Error("unauthorized"));
      }
      return res.json().then(function (data) {
        if (!res.ok) throw new Error(data.error || "Terjadi kesalahan.");
        return data;
      });
    });
  }

  function loadEntries() {
    return api("/api/entries")
      .then(function (data) {
        entries = data;
        render();
      })
      .catch(function (err) {
        console.error("Gagal memuat data:", err);
        showToast("Gagal memuat data dari server.");
      });
  }

  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "id-" + Date.now() + "-" + Math.random().toString(16).slice(2);
  }

  function esc(str) {
    var d = document.createElement("div");
    d.textContent = str == null ? "" : str;
    return d.innerHTML;
  }

  function showToast(msg) {
    var t = document.getElementById("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(showToast._h);
    showToast._h = setTimeout(function () {
      t.classList.remove("show");
    }, 2200);
  }

  // ---- Logout ----
  document.getElementById("logoutBtn").addEventListener("click", function () {
    api("/api/logout", { method: "POST" }).then(function () {
      window.location.href = "/login.html";
    });
  });

  // ---- Ganti password ----
  var passwordModal = document.getElementById("passwordModal");
  var passwordForm = document.getElementById("passwordForm");
  var passwordError = document.getElementById("passwordError");
  var passwordSaveBtn = document.getElementById("passwordSaveBtn");

  document.getElementById("passwordBtn").addEventListener("click", function () {
    passwordForm.reset();
    passwordError.style.display = "none";
    passwordModal.classList.add("open");
  });

  document.getElementById("passwordCancelBtn").addEventListener("click", function () {
    passwordModal.classList.remove("open");
  });

  passwordModal.addEventListener("click", function (ev) {
    if (ev.target === passwordModal) passwordModal.classList.remove("open");
  });

  passwordForm.addEventListener("submit", function (ev) {
    ev.preventDefault();
    var currentPassword = document.getElementById("pw_current").value;
    var newUsername = document.getElementById("pw_username").value.trim();
    var newPassword = document.getElementById("pw_new").value;
    var confirmPassword = document.getElementById("pw_confirm").value;

    passwordError.style.display = "none";

    if (newPassword !== confirmPassword) {
      passwordError.textContent = "Konfirmasi password baru tidak cocok.";
      passwordError.style.display = "block";
      return;
    }

    passwordSaveBtn.disabled = true;
    passwordSaveBtn.textContent = "Menyimpan...";

    fetch("/api/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: currentPassword, newUsername: newUsername, newPassword: newPassword })
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { ok: res.ok, data: data };
        });
      })
      .then(function (result) {
        if (result.ok) {
          window.location.href = "/login.html";
        } else {
          passwordError.textContent = result.data.error || "Gagal mengganti password.";
          passwordError.style.display = "block";
        }
      })
      .catch(function () {
        passwordError.textContent = "Tidak bisa menghubungi server.";
        passwordError.style.display = "block";
      })
      .finally(function () {
        passwordSaveBtn.disabled = false;
        passwordSaveBtn.textContent = "Simpan password baru";
      });
  });

  // ---- Photo handling (resize before sending, keeps DB light) ----
  function readAndResizeImage(file, cb) {
    var reader = new FileReader();
    reader.onload = function (ev) {
      var img = new Image();
      img.onload = function () {
        var maxDim = 900;
        var scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        var w = Math.round(img.width * scale);
        var h = Math.round(img.height * scale);
        var canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        var ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        cb(canvas.toDataURL("image/jpeg", 0.82));
      };
      img.onerror = function () {
        cb(null);
      };
      img.src = ev.target.result;
    };
    reader.onerror = function () {
      cb(null);
    };
    reader.readAsDataURL(file);
  }

  var photoDrop = document.getElementById("photoDrop");
  var photoInput = document.getElementById("f_foto");

  photoDrop.addEventListener("click", function () {
    photoInput.click();
  });
  photoInput.addEventListener("change", function () {
    var file = photoInput.files && photoInput.files[0];
    if (!file) return;
    readAndResizeImage(file, function (dataUrl) {
      if (!dataUrl) {
        showToast("Gagal membaca foto.");
        return;
      }
      pendingPhoto = dataUrl;
      renderPhotoPreview();
    });
  });

  function renderPhotoPreview() {
    if (pendingPhoto) {
      photoDrop.classList.add("has-photo");
      photoDrop.innerHTML = "";
      var img = document.createElement("img");
      img.src = pendingPhoto;
      photoDrop.appendChild(img);
    } else {
      photoDrop.classList.remove("has-photo");
      photoDrop.innerHTML = '<span id="photoLabel">Klik untuk unggah foto</span>';
    }
  }

  // ---- Form ----
  var form = document.getElementById("entryForm");
  var formTitle = document.getElementById("formTitle");
  var formSub = document.getElementById("formSub");
  var cancelBtn = document.getElementById("cancelBtn");
  var saveBtn = document.getElementById("saveBtn");

  var fields = ["no", "nama", "travel", "telepon", "member", "ket"];
  function fieldEl(name) {
    return document.getElementById("f_" + name);
  }

  function resetForm() {
    editingId = null;
    pendingPhoto = null;
    form.reset();
    renderPhotoPreview();
    formTitle.textContent = "Tambah data";
    formSub.textContent = "Isi field di bawah lalu simpan.";
    saveBtn.textContent = "Simpan data";
    cancelBtn.style.display = "none";
  }

  function startEdit(id) {
    var entry = entries.find(function (e) {
      return e.id === id;
    });
    if (!entry) return;
    editingId = id;
    fields.forEach(function (f) {
      fieldEl(f).value = entry[f] || "";
    });
    pendingPhoto = entry.foto || null;
    renderPhotoPreview();
    formTitle.textContent = "Ubah data";
    formSub.textContent = "No " + (entry.no || "-") + " — " + (entry.nama || "");
    saveBtn.textContent = "Simpan perubahan";
    cancelBtn.style.display = "inline-block";
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  form.addEventListener("submit", function (ev) {
    ev.preventDefault();
    var data = {};
    fields.forEach(function (f) {
      data[f] = fieldEl(f).value.trim();
    });
    data.foto = pendingPhoto || null;

    if (!data.nama) {
      showToast("Nama wajib diisi.");
      return;
    }

    saveBtn.disabled = true;

    var request = editingId
      ? api("/api/entries/" + editingId, { method: "PUT", body: JSON.stringify(data) })
      : api("/api/entries", { method: "POST", body: JSON.stringify(data) });

    request
      .then(function () {
        showToast(editingId ? "Perubahan disimpan." : "Data ditambahkan.");
        resetForm();
        return loadEntries();
      })
      .catch(function (err) {
        showToast(err.message || "Gagal menyimpan data.");
      })
      .finally(function () {
        saveBtn.disabled = false;
      });
  });

  cancelBtn.addEventListener("click", resetForm);

  // ---- Table render ----
  var tableBody = document.getElementById("tableBody");
  var emptyState = document.getElementById("emptyState");
  var countTag = document.getElementById("countTag");
  var filterTag = document.getElementById("filterTag");
  var searchBox = document.getElementById("searchBox");

  function matchesSearch(entry, q) {
    if (!q) return true;
    q = q.toLowerCase();
    return ["no", "nama", "travel", "telepon", "member", "ket"].some(function (f) {
      return (entry[f] || "").toLowerCase().indexOf(q) > -1;
    });
  }

  function render() {
    var q = searchBox.value.trim();
    var visible = entries.filter(function (e) {
      return matchesSearch(e, q);
    });

    countTag.textContent = entries.length + " data tersimpan";
    filterTag.textContent = q ? visible.length + " hasil ditemukan" : "";

    if (entries.length === 0) {
      tableBody.innerHTML = "";
      emptyState.style.display = "block";
      return;
    }
    emptyState.style.display = "none";

    tableBody.innerHTML = visible
      .map(function (e) {
        var photoCell = e.foto
          ? '<img src="' + e.foto + '" data-full="' + e.foto + '" class="thumb" alt="Foto ' + esc(e.nama) + '">'
          : '<div class="no-photo">—</div>';
        return (
          '<tr data-id="' + e.id + '">' +
          '<td class="no-col">' + esc(e.no) + "</td>" +
          "<td>" + esc(e.nama) + "</td>" +
          "<td>" + esc(e.travel) + "</td>" +
          "<td>" + esc(e.telepon) + "</td>" +
          "<td>" + esc(e.member) + "</td>" +
          '<td class="foto-col">' + photoCell + "</td>" +
          '<td class="ket-col">' + esc(e.ket) + "</td>" +
          '<td class="aksi-col">' +
          '<button type="button" class="ghost edit-btn">Ubah</button>' +
          '<button type="button" class="danger delete-btn">Hapus</button>' +
          "</td>" +
          "</tr>"
        );
      })
      .join("");
  }

  tableBody.addEventListener("click", function (ev) {
    var tr = ev.target.closest("tr");
    if (!tr) return;
    var id = tr.getAttribute("data-id");

    if (ev.target.classList.contains("edit-btn")) {
      startEdit(id);
    } else if (ev.target.classList.contains("delete-btn")) {
      var entry = entries.find(function (e) {
        return e.id === id;
      });
      if (entry && confirm('Hapus data "' + (entry.nama || entry.no) + '"?')) {
        api("/api/entries/" + id, { method: "DELETE" })
          .then(function () {
            if (editingId === id) resetForm();
            showToast("Data dihapus.");
            return loadEntries();
          })
          .catch(function (err) {
            showToast(err.message || "Gagal menghapus data.");
          });
      }
    } else if (ev.target.classList.contains("thumb")) {
      openLightbox(ev.target.getAttribute("data-full"));
    }
  });

  searchBox.addEventListener("input", render);

  // ---- Lightbox ----
  var lightbox = document.getElementById("lightbox");
  var lightboxImg = document.getElementById("lightboxImg");
  function openLightbox(src) {
    lightboxImg.src = src;
    lightbox.classList.add("open");
  }
  lightbox.addEventListener("click", function () {
    lightbox.classList.remove("open");
    lightboxImg.src = "";
  });
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape") lightbox.classList.remove("open");
  });

  // ---- Export to Excel (server generates the file) ----
  document.getElementById("exportBtn").addEventListener("click", function () {
    if (entries.length === 0) {
      showToast("Belum ada data untuk diekspor.");
      return;
    }
    window.location.href = "/api/export";
  });

  // ---- Init ----
  loadEntries();
})();
