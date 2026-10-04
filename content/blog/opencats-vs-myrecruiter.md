---
title: "OpenCATS vs MyRecruiter: Open Source ATS Head-to-Head"
description: "Compare OpenCATS vs MyRecruiter in this practical guide. Learn how the legacy open-source ATS stacks up against modern, transparent AI recruiting software."
date: 2026-02-28
author: "MyRecruiter Team"
image: "/og-image.png"
tags: ["opencats-vs-myrecruiter", "open-source-ats", "self-hosted-ats", "ats", "recruitment"]
---

Evaluating **OpenCATS vs MyRecruiter** comes down to a choice between a functional legacy system and a modern, Docker-ready recruiting engine. OpenCATS is a traditional PHP-based open-source ATS that has served community needs for over 15 years, while MyRecruiter is a next-generation platform built with Nuxt, Postgres, and transparent AI matching logic.

Both systems solve the "data hostage" problem by allowing you to self-host your candidate data without paying a per-seat tax. However, they take radically different approaches to user interface, technical architecture, and automation. This comparison breaks down the core architecture, recruiter experience, and deployment reality of each specialized platform to help you choose the right open-source ATS for your hiring needs.

## What is OpenCATS? The Legacy Open Source ATS

OpenCATS originated as an open-source spin-off of the proprietary CATS ATS in the late 2000s (now maintained on [GitHub](https://github.com/opencats/OpenCATS)). Since then, it has maintained a dedicated user base, primarily among small recruiting agencies and independent headhunters who need a free, workable solution.

It relies on a traditional [LAMP stack](https://en.wikipedia.org/wiki/LAMP_(software_bundle)). For teams looking for a completely free system with basic applicant tracking capabilities, OpenCATS checks the boxes. It handles candidate logging, basic resume storage, and job order tracking. 

However, users consistently mention a steep learning curve. A common sentiment on tech forums notes: "OpenCATS is a lifesaver for our small agency because it's free, but training new recruiters on its interface takes weeks." The architecture reflects its age, lacking native API integrations, modern containerized deployments, or automation features out of the box.

## What is MyRecruiter? The Modern, Glass Box Alternative

MyRecruiter was built explicitly to replace the aging infrastructure of traditional open-source systems and the expensive, opaque algorithms of modern SaaS platforms. Designed around a modern tech stack ([Nuxt 4](https://nuxt.com/), Docker, MinIO, and Postgres), it provides complete infrastructure ownership.

The standout philosophy of MyRecruiter is the **"Glass Box" AI principle**. Rather than hiding candidate fit scores behind proprietary algorithms, every AI ranking includes a visible, auditable **Matching Logic** summary. Recruiters see exactly why a candidate was recommended or passed over. 

MyRecruiter eliminates the anti-growth penalty—there is no per-seat pricing (drastically reducing the [total cost of ownership](/blog/total-cost-of-ownership-saas-ats-vs-self-hosted)). You own the software and the candidate data, ensuring your talent pipeline remains a permanent asset, not a monthly rental.

## OpenCATS vs MyRecruiter: Core Feature Comparison

When placed side-by-side, the divergence in technical approach becomes clear:

| Feature | OpenCATS | MyRecruiter |
|---------|---------|---------|
| **Core Tech Stack** | PHP, MySQL, Apache | [Nuxt 4](https://nuxt.com/), Typescript, Postgres, MinIO |
| **Deployment** | Manual LAMP configuration | Instant via Docker Compose |
| **User Interface** | Traditional, menu-heavy, dated | Recruiter-first, progressive disclosure |
| **AI Matching** | None | "Glass Box" Transparent local AI (Ollama) |
| **Data Storage** | Local database / server folders | Local database + MinIO/S3 object storage |
| **Pricing** | Free (Open Source) | Free (Open Source) |

## User Interface and Recruiter Experience

Recruiter efficiency directly impacts hiring speed. An ATS should answer "what do I need to do next?" within three seconds of opening the dashboard.

**OpenCATS** requires users to navigate through dense drop-downs and list views. Because the software was designed over a decade ago, it lacks modern single-page application (SPA) responsiveness. Form submissions trigger page reloads, and visualizing a candidate's progress through a hiring pipeline requires clicking into individual records rather than dragging and dropping in a visual board.

**MyRecruiter** takes a recruiter-first UX approach. The interface relies on progressive disclosure: it surfaces summary data immediately and provides deep-dive details only upon request. Job management relies on clear, state-based workflows (draft → open → closed → archived), and the integration with modern interface components means zero page reloads.

## Deployment and Self-Hosting: Old School vs Modern Docker

Self-hosting an ATS requires technical maintenance, but the method of deployment dictates how painful that maintenance will be.

Deploying **OpenCATS** typically involves manually provisioning an Ubuntu server, configuring Apache or Nginx, setting up MySQL databases, and managing PHP dependencies. While veteran sysadmins are comfortable with this, it introduces friction for modern development teams used to containerization.

**MyRecruiter** uses modern containerized deployment. Generating a complete production-ready environment requires a simple `docker-compose.yml` file. 

```yaml
# A typical modern ATS localized deployment
services:
  postgres:
    image: postgres:15
  minio:
    image: minio/minio
  myrecruiter:
    image: myrecruiter/ats:latest
    environment:
      - DATABASE_URL=postgres://...
```

Modern Docker environments reduce deployment time significantly compared to manual server configuration, allowing teams to spin up their ATS core infrastructure in under ten minutes.

## AI and Automation: The MyRecruiter Advantage

The recruitment industry is rapidly adopting AI for candidate screening, yet most off-the-shelf applicant tracking systems fail to provide explainability.

**OpenCATS** operates without native AI or automation. Scanning resumes, tagging skills, and scoring candidates remain entirely manual processes.

**MyRecruiter** integrates AI securely and transparently. Using local LLMs via [Ollama](https://ollama.com/), sensitive candidate Personally Identifiable Information (PII) never leaves the company's private network. Furthermore, MyRecruiter strictly adheres to the "Glass Box" mandate: if a candidate receives an 85% match for a software engineering role, the system outputs the exact semantic logic used to generate that score.

## Verdict: Which Open Source ATS is Right for You?

Choosing between these platforms depends entirely on your technical resources and workflow requirements. 

- **Choose OpenCATS if** you are maintaining an existing LAMP stack, prefer traditional multi-page web applications, and do not need advanced UI or AI capabilities. It remains a reliable, truly zero-cost engine for basic record keeping.
- **Choose MyRecruiter if** you want a modern, Docker-deployable architecture with a responsive UI. It is specifically designed for growing teams that need transparent AI candidate matching and complete data sovereignty without sacrificing recruiter efficiency.

By self-hosting either option, you guarantee your talent pool remains a permanent asset. 

For further reading on open-source recruiting software, check out our guide on the [best open source applicant tracking systems](/blog/best-open-source-applicant-tracking-systems) and our breakdown of [self-hosted vs cloud ATS](/blog/self-hosted-vs-cloud-ats) deployments.
