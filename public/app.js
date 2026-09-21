(function () {
  "use strict";

  var entries = [];
  var editingId = null;
  var pendingPhotos = [];
  var fotoCache = {}; // id -> array of dataURL, dimuat belakangan (lazy)
  var myRole = null; // 'admin' | 'anggota'

  var state = {
    page: 1,
    limit: 30,
    q: "",
    no: "",
    member: "",
    total: 0,
    totalPages: 1
  };

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

  function qs(params) {
    return Object.keys(params)
      .filter(function (k) { return params[k] !== "" && params[k] != null; })
      .map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(params[k]); })
      .join("&");
  }

  function loadEntries() {
    var query = qs({ page: state.page, limit: state.limit, q: state.q, no: state.no, member: state.member });
    return api("/api/entries?" + query)
      .then(function (result) {
        entries = result.data;
        state.total = result.total;
        state.totalPages = result.totalPages;
        render();
      })
      .catch(function (err) {
        if (err.message !== "unauthorized") {
          console.error("Gagal memuat data:", err);
          showToast("Gagal memuat data dari server.");
        }
      });
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
    showToast._h = setTimeout(function () { t.classList.remove("show"); }, 2200);
  }

  function debounce(fn, wait) {
    var t;
    return function () {
      var args = arguments;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(null, args); }, wait);
    };
  }

  // ---- Role-based UI ----
  function applyRoleUI() {
    var isAdmin = myRole === "admin";
    document.querySelectorAll("[data-admin-only]").forEach(function (el) {
      el.style.display = isAdmin ? "" : "none";
    });
    document.getElementById("roleTag").textContent = isAdmin ? "Admin" : "Anggota (lihat & cari saja)";
    document.body.classList.toggle("role-anggota", !isAdmin);
  }

  // ---- Logout ----
  document.getElementById("logoutBtn").addEventListener("click", function () {
    api("/api/logout", { method: "POST" }).then(function () {
      window.location.href = "/login.html";
    });
  });

  // ---- Photo handling (multi-foto, resize sebelum diupload) ----
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
        canvas.width = w; canvas.height = h;
        var ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        cb(canvas.toDataURL("image/jpeg", 0.82));
      };
      img.onerror = function () { cb(null); };
      img.src = ev.target.result;
    };
    reader.onerror = function () { cb(null); };
    reader.readAsDataURL(file);
  }

  var photoDrop = document.getElementById("photoDrop");
  var photoInput = document.getElementById("f_foto");

  if (photoDrop) {
    photoDrop.addEventListener("click", function () { photoInput.click(); });
    photoInput.addEventListener("change", function () {
      var files = Array.prototype.slice.call(photoInput.files || []);
      if (files.length === 0) return;
      var pending = files.length;
      files.forEach(function (file) {
        readAndResizeImage(file, function (dataUrl) {
          if (dataUrl) pendingPhotos.push(dataUrl);
          pending--;
          if (pending === 0) {
            renderPhotoPreview();
            photoInput.value = "";
          }
        });
      });
    });
  }

  function removePendingPhoto(index) {
    pendingPhotos.splice(index, 1);
    renderPhotoPreview();
  }

  function renderPhotoPreview() {
    if (pendingPhotos.length > 0) {
      photoDrop.classList.add("has-photo");
      photoDrop.innerHTML = "";
      var grid = document.createElement("div");
      grid.className = "photo-grid";
      pendingPhotos.forEach(function (src, idx) {
        var item = document.createElement("div");
        item.className = "photo-item";
        var img = document.createElement("img");
        img.src = src;
        var removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "photo-remove";
        removeBtn.textContent = "×";
        removeBtn.addEventListener("click", function (ev) {
          ev.stopPropagation();
          removePendingPhoto(idx);
        });
        item.appendChild(img);
        item.appendChild(removeBtn);
        grid.appendChild(item);
      });
      var addMore = document.createElement("div");
      addMore.className = "photo-add-more";
      addMore.textContent = "+ Tambah foto";
      grid.appendChild(addMore);
      photoDrop.appendChild(grid);
    } else {
      photoDrop.classList.remove("has-photo");
      photoDrop.innerHTML = '<span id="photoLabel">Klik untuk unggah foto (bisa pilih lebih dari satu)</span>';
    }
  }

  // ---- Form (admin only, tapi tetap dijaga di frontend & backend) ----
  var form = document.getElementById("entryForm");
  var formTitle = document.getElementById("formTitle");
  var formSub = document.getElementById("formSub");
  var cancelBtn = document.getElementById("cancelBtn");
  var saveBtn = document.getElementById("saveBtn");
  var fields = ["no", "nama", "travel", "telepon", "member", "ket"];
  function fieldEl(name) { return document.getElementById("f_" + name); }

  function resetForm() {
    editingId = null;
    pendingPhotos = [];
    if (form) form.reset();
    renderPhotoPreview();
    formTitle.textContent = "Tambah data";
    formSub.textContent = "Isi field di bawah lalu simpan.";
    saveBtn.textContent = "Simpan data";
    cancelBtn.style.display = "none";
  }

  function startEdit(id) {
    var entry = entries.find(function (e) { return e.id === id; });
    if (!entry) return;
    editingId = id;
    fields.forEach(function (f) { fieldEl(f).value = entry[f] || ""; });
    formTitle.textContent = "Ubah data";
    formSub.textContent = "No " + (entry.no || "-") + " — " + (entry.nama || "") + " (memuat foto...)";
    saveBtn.textContent = "Simpan perubahan";
    cancelBtn.style.display = "inline-block";
    window.scrollTo({ top: 0, behavior: "smooth" });

    pendingPhotos = [];
    renderPhotoPreview();
    getFotosForEntry(id).then(function (fotos) {
      pendingPhotos = fotos.slice();
      renderPhotoPreview();
      formSub.textContent = "No " + (entry.no || "-") + " — " + (entry.nama || "");
    });
  }

  if (form) {
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var data = {};
      fields.forEach(function (f) { data[f] = fieldEl(f).value.trim(); });
      data.fotos = pendingPhotos.slice();

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
        .finally(function () { saveBtn.disabled = false; });
    });
    cancelBtn.addEventListener("click", resetForm);
  }

  // ---- Lazy-load foto per entry (bukan sekaligus di list, biar ringan) ----
  function getFotosForEntry(id) {
    if (fotoCache[id]) return Promise.resolve(fotoCache[id]);
    return api("/api/entries/" + id + "/fotos")
      .then(function (result) {
        fotoCache[id] = result.fotos || [];
        return fotoCache[id];
      })
      .catch(function () { return []; });
  }

  // ---- Table render ----
  var tableBody = document.getElementById("tableBody");
  var emptyState = document.getElementById("emptyState");
  var countTag = document.getElementById("countTag");
  var filterTag = document.getElementById("filterTag");
  var searchBox = document.getElementById("searchBox");
  var memberFilter = document.getElementById("memberFilter");
  var noSearchBox = document.getElementById("noSearchBox");
  var pageInfo = document.getElementById("pageInfo");
  var prevPageBtn = document.getElementById("prevPageBtn");
  var nextPageBtn = document.getElementById("nextPageBtn");

  function render() {
    countTag.textContent = state.total + " data tersimpan";
    var activeFilters = [];
    if (state.no) activeFilters.push('no "' + state.no + '"');
    if (state.q) activeFilters.push('"' + state.q + '"');
    if (state.member) activeFilters.push(state.member);
    filterTag.textContent = activeFilters.length ? state.total + " hasil ditemukan" : "";

    pageInfo.textContent = "Halaman " + state.page + " dari " + state.totalPages;
    prevPageBtn.disabled = state.page <= 1;
    nextPageBtn.disabled = state.page >= state.totalPages;

    if (entries.length === 0) {
      tableBody.innerHTML = "";
      emptyState.style.display = "block";
      return;
    }
    emptyState.style.display = "none";

    var isAdmin = myRole === "admin";
    tableBody.innerHTML = entries
      .map(function (e) {
        var fotoCell = e.foto_count > 0
          ? '<button type="button" class="foto-badge" data-id="' + e.id + '">📷 ' + e.foto_count + '</button>'
          : '<div class="no-photo">—</div>';
        var aksiCell = isAdmin
          ? '<button type="button" class="ghost edit-btn">Ubah</button><button type="button" class="danger delete-btn">Hapus</button>'
          : '<span class="ink-soft">—</span>';
        return (
          '<tr data-id="' + e.id + '">' +
          '<td class="no-col">' + esc(e.no) + "</td>" +
          "<td>" + esc(e.nama) + "</td>" +
          "<td>" + esc(e.travel) + "</td>" +
          "<td>" + esc(e.telepon) + "</td>" +
          "<td>" + esc(e.member) + "</td>" +
          '<td class="foto-col">' + fotoCell + "</td>" +
          '<td class="ket-col">' + esc(e.ket) + "</td>" +
          '<td class="aksi-col">' + aksiCell + "</td>" +
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
      var entry = entries.find(function (e) { return e.id === id; });
      if (entry && confirm('Hapus data "' + (entry.nama || entry.no) + '"?')) {
        api("/api/entries/" + id, { method: "DELETE" })
          .then(function () {
            if (editingId === id) resetForm();
            showToast("Data dihapus.");
            return loadEntries();
          })
          .catch(function (err) { showToast(err.message || "Gagal menghapus data."); });
      }
    } else if (ev.target.classList.contains("foto-badge")) {
      var fotoId = ev.target.getAttribute("data-id");
      ev.target.textContent = "Memuat...";
      getFotosForEntry(fotoId).then(function (fotos) {
        if (fotos.length > 0) openLightbox(fotos, 0);
        var entry = entries.find(function (e) { return e.id === fotoId; });
        ev.target.textContent = "📷 " + (entry ? entry.foto_count : fotos.length);
      });
    }
  });

  // ---- Search & filter (server-side, dengan debounce biar nggak lag) ----
  var debouncedSearch = debounce(function () {
    state.q = searchBox.value.trim();
    state.no = ""; // pencarian umum & pencarian nomor kartu saling eksklusif
    noSearchBox.value = "";
    state.page = 1;
    loadEntries();
  }, 350);
  searchBox.addEventListener("input", debouncedSearch);

  var debouncedNoSearch = debounce(function () {
    state.no = noSearchBox.value.trim();
    state.q = "";
    searchBox.value = "";
    state.page = 1;
    loadEntries();
  }, 300);
  noSearchBox.addEventListener("input", debouncedNoSearch);

  memberFilter.addEventListener("change", function () {
    state.member = memberFilter.value;
    state.page = 1;
    loadEntries();
  });

  prevPageBtn.addEventListener("click", function () {
    if (state.page > 1) { state.page--; loadEntries(); }
  });
  nextPageBtn.addEventListener("click", function () {
    if (state.page < state.totalPages) { state.page++; loadEntries(); }
  });

  // ---- Lightbox (dengan navigasi kalau foto lebih dari 1) ----
  var lightbox = document.getElementById("lightbox");
  var lightboxImg = document.getElementById("lightboxImg");
  var lightboxCounter = document.getElementById("lightboxCounter");
  var lbPrev = document.getElementById("lbPrev");
  var lbNext = document.getElementById("lbNext");
  var lbFotos = [];
  var lbIndex = 0;

  function openLightbox(fotos, index) {
    lbFotos = fotos;
    lbIndex = index;
    showLightboxImage();
    lightbox.classList.add("open");
  }
  function showLightboxImage() {
    lightboxImg.src = lbFotos[lbIndex];
    lightboxCounter.textContent = lbFotos.length > 1 ? (lbIndex + 1) + " / " + lbFotos.length : "";
    lbPrev.style.display = lbFotos.length > 1 ? "flex" : "none";
    lbNext.style.display = lbFotos.length > 1 ? "flex" : "none";
  }
  lbPrev.addEventListener("click", function (ev) {
    ev.stopPropagation();
    lbIndex = (lbIndex - 1 + lbFotos.length) % lbFotos.length;
    showLightboxImage();
  });
  lbNext.addEventListener("click", function (ev) {
    ev.stopPropagation();
    lbIndex = (lbIndex + 1) % lbFotos.length;
    showLightboxImage();
  });
  lightbox.addEventListener("click", function (ev) {
    if (ev.target === lightbox) {
      lightbox.classList.remove("open");
      lightboxImg.src = "";
    }
  });
  document.addEventListener("keydown", function (ev) {
    if (!lightbox.classList.contains("open")) return;
    if (ev.key === "Escape") lightbox.classList.remove("open");
    if (ev.key === "ArrowLeft") lbPrev.click();
    if (ev.key === "ArrowRight") lbNext.click();
  });

  // ---- Export ke Excel ----
  var exportBtn = document.getElementById("exportBtn");
  if (exportBtn) {
    exportBtn.addEventListener("click", function () {
      if (state.total === 0) {
        showToast("Belum ada data untuk diekspor.");
        return;
      }
      window.location.href = "/api/export";
    });
  }

  // ---- Impor data (admin only) ----
  var importBtn = document.getElementById("importBtn");
  var importFile = document.getElementById("importFile");
  if (importBtn) {
    importBtn.addEventListener("click", function () { importFile.click(); });
    importFile.addEventListener("change", function () {
      var file = importFile.files && importFile.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function (ev) {
        var data;
        try { data = JSON.parse(ev.target.result); }
        catch (err) { showToast("File JSON tidak valid."); importFile.value = ""; return; }

        var list = Array.isArray(data) ? data : data.entries;
        if (!Array.isArray(list) || list.length === 0) {
          showToast("Tidak ada data di dalam file ini.");
          importFile.value = "";
          return;
        }
        if (!confirm("Impor " + list.length + " data ke database? Data ini akan ditambahkan, bukan menimpa data yang sudah ada.")) {
          importFile.value = "";
          return;
        }

        var MAX_BATCH_BYTES = 6 * 1024 * 1024;
        var batches = [];
        var currentBatch = [];
        var currentSize = 0;
        list.forEach(function (entry) {
          var entrySize = JSON.stringify(entry).length;
          if (currentBatch.length > 0 && currentSize + entrySize > MAX_BATCH_BYTES) {
            batches.push(currentBatch); currentBatch = []; currentSize = 0;
          }
          currentBatch.push(entry);
          currentSize += entrySize;
        });
        if (currentBatch.length > 0) batches.push(currentBatch);

        importBtn.disabled = true;
        var totalAdded = 0, totalSkipped = 0, batchIndex = 0;

        function runNextBatch() {
          if (batchIndex >= batches.length) {
            importBtn.disabled = false;
            importBtn.textContent = "Impor data";
            importFile.value = "";
            showToast(totalAdded + " data berhasil diimpor" + (totalSkipped ? ", " + totalSkipped + " dilewati." : "."));
            loadEntries();
            return;
          }
          importBtn.textContent = "Mengimpor... (" + (batchIndex + 1) + "/" + batches.length + ")";
          api("/api/entries/bulk", { method: "POST", body: JSON.stringify({ entries: batches[batchIndex] }) })
            .then(function (result) {
              totalAdded += result.added || 0;
              totalSkipped += result.skipped || 0;
              batchIndex++;
              runNextBatch();
            })
            .catch(function (err) {
              importBtn.disabled = false;
              importBtn.textContent = "Impor data";
              importFile.value = "";
              showToast("Berhenti di batch " + (batchIndex + 1) + "/" + batches.length + ": " + (err.message || "gagal") + ". " + totalAdded + " data sudah sempat masuk.");
              loadEntries();
            });
        }
        runNextBatch();
      };
      reader.onerror = function () { showToast("Gagal membaca file."); importFile.value = ""; };
      reader.readAsText(file);
    });
  }

  // ---- Hapus semua data (admin only) ----
  var deleteAllBtn = document.getElementById("deleteAllBtn");
  if (deleteAllBtn) {
    deleteAllBtn.addEventListener("click", function () {
      if (state.total === 0) { showToast("Tidak ada data untuk dihapus."); return; }
      var confirmText = prompt(
        'Ini akan menghapus SEMUA ' + state.total + ' data secara permanen dan tidak bisa dibatalkan.\nKetik "HAPUS" (huruf besar) untuk konfirmasi:'
      );
      if (confirmText !== "HAPUS") {
        if (confirmText !== null) showToast("Dibatalkan — teks konfirmasi tidak cocok.");
        return;
      }
      api("/api/entries", { method: "DELETE" })
        .then(function (result) {
          showToast(result.deleted + " data berhasil dihapus.");
          state.page = 1;
          return loadEntries();
        })
        .catch(function (err) { showToast(err.message || "Gagal menghapus data."); });
    });
  }

  // ---- Ganti password (admin only) ----
  var passwordModal = document.getElementById("passwordModal");
  var passwordForm = document.getElementById("passwordForm");
  var passwordError = document.getElementById("passwordError");
  var passwordSaveBtn = document.getElementById("passwordSaveBtn");
  var passwordBtn = document.getElementById("passwordBtn");

  if (passwordBtn) {
    passwordBtn.addEventListener("click", function () {
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
      var newMemberPassword = document.getElementById("pw_member_new").value;
      var confirmMemberPassword = document.getElementById("pw_member_confirm").value;

      passwordError.style.display = "none";

      if (newPassword && newPassword !== confirmPassword) {
        passwordError.textContent = "Konfirmasi password admin tidak cocok.";
        passwordError.style.display = "block";
        return;
      }
      if (newMemberPassword && newMemberPassword !== confirmMemberPassword) {
        passwordError.textContent = "Konfirmasi password anggota tidak cocok.";
        passwordError.style.display = "block";
        return;
      }

      passwordSaveBtn.disabled = true;
      passwordSaveBtn.textContent = "Menyimpan...";

      api("/api/change-password", {
        method: "POST",
        body: JSON.stringify({
          currentPassword: currentPassword,
          newUsername: newUsername,
          newPassword: newPassword || undefined,
          newMemberPassword: newMemberPassword || undefined
        })
      })
        .then(function () {
          window.location.href = "/login.html";
        })
        .catch(function (err) {
          passwordError.textContent = err.message || "Gagal mengganti password.";
          passwordError.style.display = "block";
        })
        .finally(function () {
          passwordSaveBtn.disabled = false;
          passwordSaveBtn.textContent = "Simpan perubahan";
        });
    });
  }

  // ---- Init: cek role dulu, baru muat data ----
  api("/api/session")
    .then(function (session) {
      myRole = session.role;
      applyRoleUI();
      return loadEntries();
    })
    .catch(function () {
      window.location.href = "/login.html";
    });
})();
