// The fixture's page-context "bundle": it reads the snapshot off the global the
// page's own `<script src="/build.js">` tag assigned (#743), the one file every
// OMEGA browser surface loads first. See background.js for the full note.
document.getElementById('main-content').dataset.brand = window.OMEGA_BUILD_JSON.config.brand.id;
