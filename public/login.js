(function () {
  "use strict";

  var form = document.getElementById("loginForm");
  var errorBox = document.getElementById("loginError");
  var loginBtn = document.getElementById("loginBtn");

  form.addEventListener("submit", function (ev) {
    ev.preventDefault();
    var username = document.getElementById("username").value.trim();
    var password = document.getElementById("password").value;

    errorBox.style.display = "none";
    loginBtn.disabled = true;
    loginBtn.textContent = "Memeriksa...";

    fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: username, password: password })
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { ok: res.ok, data: data };
        });
      })
      .then(function (result) {
        if (result.ok) {
          window.location.href = "/";
        } else {
          errorBox.textContent = result.data.error || "Login gagal.";
          errorBox.style.display = "block";
        }
      })
      .catch(function () {
        errorBox.textContent = "Tidak bisa menghubungi server. Coba lagi.";
        errorBox.style.display = "block";
      })
      .finally(function () {
        loginBtn.disabled = false;
        loginBtn.textContent = "Masuk";
      });
  });
})();
