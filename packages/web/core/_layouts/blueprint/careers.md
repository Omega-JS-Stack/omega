---
layout: modules/utilities/redirect

meta:
  title: "Careers - {{ resolved.config.brand.name }}"
  description: "We are always looking for new talent to join the {{ resolved.config.brand.name }} team. If you are interested in working with us, please fill out the form."
  breadcrumb: "Careers"

redirect:
  url: "https://docs.google.com/forms/d/e/1FAIpQLSeLELeP0Om3stwaxM3HbzirXxleuPpEPDVsZ19ubFzozbxKOw/viewform?usp=pp_url&entry.1492864166={{ resolved.config.brand.name }}"
---

{{ content | omega_content_format }}
