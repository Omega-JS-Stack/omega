---
layout: blueprint/alternatives/alternative
alternative:
  competitor:
    name: "Acme Growth"
    description: "The incumbent."
  comparison:
    features:
      - name: "Automation depth"
        icon: "bolt"
        ours: "Deep"
        theirs: "Shallow"
  # Exercises the CENTER faq variant (the only center caller) + call-site
  # liquification of the {{ site.brand.name }} tokens.
  faqs:
    superheadline:
      text: "FAQs"
    headline: "Questions about"
    headline_accent: "switching"
    subheadline: "Answers from the {{ site.brand.name }} team."
    items:
      - question: "How long does a {{ site.brand.name }} migration take?"
        answer: "Most teams finish in under a day."
      - question: "Can I import my data?"
        answer: "Yes — imports are built in."
---
