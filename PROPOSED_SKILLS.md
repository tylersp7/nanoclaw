# Proposed NanoClaw Skills for Freelance Success

**Created:** February 10, 2026
**Focus:** Lead generation, client management, and automation work

---

## 🔥 High Priority Skills

### 1. `/add-linkedin` - LinkedIn Lead Generation

**Purpose:** Monitor LinkedIn for freelance opportunities and engage with potential clients

**Capabilities:**
- Monitor "Who's hiring" posts in relevant groups
- Track job postings matching your skills (n8n, automation, bug bounty, VPS)
- Alert when connections post about needing help
- Auto-save interesting leads to a tracking system
- Monitor relevant hashtags (#n8n, #automation, #freelance)

**Example Tasks:**
```
@Andy every 2 hours, check LinkedIn for posts mentioning "n8n", "automation developer", or "workflow automation" in the Freelance Developers group. If any match my skills, send me a summary with the poster's profile and how to respond.

@Andy monitor my LinkedIn connections' posts. If anyone mentions needing help with automation, APIs, or security, alert me immediately with context so I can reach out.

@Andy every Monday, search LinkedIn jobs for "n8n developer", "automation engineer", and "bug bounty" posted in the last week. Send me the top 5 matches with company info and application links.
```

**Implementation Approach:**
- Use LinkedIn unofficial API or Playwright browser automation
- Store lead information in SQLite
- Deduplicate opportunities
- Track response rates

---

### 2. `/add-github-monitor` - Portfolio & Lead Generation

**Purpose:** Track GitHub activity for portfolio building and finding consulting opportunities

**Capabilities:**
- Monitor repos you've starred/contributed to for issues needing help
- Find "Help Wanted" issues in n8n, automation tool repos
- Track when your repos get stars/forks (social proof)
- Monitor discussions where people need automation help
- Auto-update portfolio based on commits

**Example Tasks:**
```
@Andy monitor the n8n GitHub repo for issues tagged "help wanted" or "good first issue". When found, check if I have relevant skills and send me a summary with the issue link and complexity estimate.

@Andy every week, check GitHub discussions in automation-related repos for people asking "how do I automate X". If it matches my skills, send me the discussion link so I can offer consulting.

@Andy track stars and forks on my public repos. When I hit milestones (10, 50, 100 stars), update my portfolio document and suggest I post about it on LinkedIn.
```

---

### 3. `/add-job-board-scraper` - Freelance Platform Monitor

**Purpose:** Monitor Upwork, Fiverr, Freelancer, etc. for relevant gigs

**Capabilities:**
- Scrape job boards for automation/n8n/security keywords
- Filter by budget, duration, client rating
- Alert for high-value opportunities matching your skills
- Track proposal success rates
- Monitor competitor profiles

**Example Tasks:**
```
@Andy every 4 hours, check Upwork for new jobs containing "n8n", "workflow automation", "API integration", or "bug bounty". Filter for budget $500+, client rating 4.5+. Send me top 3 matches with quick proposal ideas.

@Andy monitor Freelancer.com for security/automation projects. When a project matches "bug bounty", "pentesting", or "security automation", alert me within 30 minutes so I can bid early.

@Andy every Friday, analyze the past week's freelance job postings. Tell me which skills are trending, average budgets, and whether I should adjust my profile keywords.
```

---

### 4. `/add-reddit-monitor` - Community Lead Generation

**Purpose:** Monitor Reddit for freelance opportunities and engagement

**Capabilities:**
- Track r/forhire, r/freelance, r/n8n, r/selfhosted
- Find "Need help with..." posts in relevant subreddits
- Monitor who's asking about automation problems
- Engage strategically (Andy drafts replies)

**Example Tasks:**
```
@Andy monitor r/forhire and r/freelance_forhire for posts about automation, n8n, API integration, or security. When found, send me the post with a draft response highlighting my relevant experience.

@Andy every day, check r/n8n and r/selfhosted for people asking how to automate workflows. If it's a problem I can solve, send me the post and suggest whether to reply publicly or DM for consulting.

@Andy track r/sysadmin and r/devops for threads about VPS security or automation. When someone asks for help, alert me so I can position my bug bounty/automation expertise.
```

---

### 5. `/add-hn-monitor` - HackerNews Opportunities

**Purpose:** Monitor HN for "Who's Hiring" and "Ask HN: How do I..." posts

**Capabilities:**
- Parse monthly "Who's Hiring" threads
- Filter by remote, contract, automation keywords
- Track "Ask HN" posts about automation problems
- Monitor Show HN for potential collaboration

**Example Tasks:**
```
@Andy on the first of every month, check the HackerNews "Who's Hiring" thread. Filter for remote positions mentioning n8n, automation, Python, security, or API work. Send me top 10 matches sorted by company quality.

@Andy monitor "Ask HN" posts for questions about workflow automation, API integration, or self-hosted solutions. If someone is asking how to solve a problem I can solve, alert me immediately with the post and a suggested reply angle.

@Andy track "Show HN" posts about automation tools. When someone launches a new tool, send me the post and suggest how I could offer integration services or become an early power user.
```

---

## 💼 Client Management Skills

### 6. `/add-proposal-generator` - Auto-generate Tailored Proposals

**Purpose:** Help write proposals faster with templates and AI

**Capabilities:**
- Template library for different project types
- Auto-customize based on job description
- Include relevant portfolio pieces
- Calculate pricing based on scope

**Example Tasks:**
```
@Andy I found an n8n workflow automation job on Upwork. Here's the description: [paste]. Generate a proposal highlighting my VPS automation experience (BeastMode, Auto Blogger) and suggest pricing based on complexity.

@Andy create a proposal template for "API integration" projects. Include sections for: understanding their needs, my approach, relevant experience (reference my GitHub), timeline, and pricing structure.
```

---

### 7. `/add-calendar-integration` - Smart Scheduling

**Purpose:** Manage client meetings and project deadlines

**Capabilities:**
- Google Calendar integration
- Send availability for client calls
- Block time for deep work
- Deadline reminders with project context

**Example Tasks:**
```
@Andy when a potential client asks for a call, check my calendar and send them 3 available time slots this week (prefer afternoons, avoid Mondays before 10am).

@Andy I have a project deadline in 2 weeks. Break it into milestones and add calendar blocks for focused work time. Remind me 2 days before each milestone.

@Andy every Sunday, review my calendar for the week. Tell me how many client hours are scheduled, how much deep work time I have, and whether I'm overcommitted.
```

---

## 🤖 n8n Specific Skills

### 8. `/add-n8n-community-monitor` - n8n Community Engagement

**Purpose:** Build reputation in n8n community for lead generation

**Capabilities:**
- Monitor n8n forum for unanswered questions
- Track n8n Discord for help requests
- Find n8n template opportunities
- Monitor n8n GitHub issues

**Example Tasks:**
```
@Andy monitor the n8n community forum for unanswered questions about complex workflows, API integrations, or self-hosting. Send me 3-5 questions daily where I can provide value and showcase expertise.

@Andy check the n8n Discord #help channel every 2 hours for questions I can answer. If someone is struggling with something I've done before (VPS setup, automation, API work), alert me so I can help and build credibility.

@Andy every week, check n8n GitHub issues for feature requests related to security, self-hosting, or advanced automation. If any match my expertise, send me the issue link and suggest how I could contribute (potentially leading to consulting work).
```

---

### 9. `/add-template-marketplace-tracker` - Monetize n8n Templates

**Purpose:** Create and sell n8n workflow templates

**Capabilities:**
- Track popular n8n templates
- Identify gaps in template marketplace
- Monitor download/usage stats
- Find template improvement opportunities

**Example Tasks:**
```
@Andy analyze popular n8n templates on the community library. Tell me which categories have the most demand but fewest quality templates. Suggest 3 template ideas I could create based on my BeastMode/Auto Blogger experience.

@Andy if I publish an n8n template, monitor its downloads and ratings. When it gets good feedback, remind me to create a blog post/LinkedIn post about it for marketing.

@Andy every month, check trending automation use cases on Reddit/HN. Suggest n8n templates I could create that solve those problems and would attract freelance clients.
```

---

## 🎨 Portfolio & Marketing Skills

### 10. `/add-portfolio-updater` - Auto-maintain Portfolio

**Purpose:** Keep portfolio current without manual work

**Capabilities:**
- Track GitHub commits and completed projects
- Generate project descriptions from git history
- Update skills list based on recent work
- Create case studies from project outcomes

**Example Tasks:**
```
@Andy every 2 weeks, review my GitHub activity on vps_bugbounty and auto_blogger_vps. Generate a portfolio update describing new features, technical challenges solved, and tools used. Draft it for my website.

@Andy when I complete a freelance project, interview me about the results (time saved, problems solved, client feedback). Generate a case study I can add to my portfolio and share on LinkedIn.

@Andy maintain a running list of my technical skills. When I use a new tool, language, or service in a project, add it to the list. Every quarter, suggest skills I should learn based on job market trends.
```

---

### 11. `/add-content-scheduler` - Marketing Automation

**Purpose:** Stay visible to potential clients through content

**Capabilities:**
- Schedule LinkedIn posts about projects
- Tweet about automation tips
- Draft blog posts from project learnings
- Engage with potential clients' content

**Example Tasks:**
```
@Andy every Monday, draft a LinkedIn post about something I learned last week (from VPS work, freelance projects, or automation challenges). Include technical details and a takeaway. Schedule it for Tuesday 10am.

@Andy when I solve an interesting automation problem, draft a tweet thread explaining the problem, solution, and tools used. Make it educational and include relevant hashtags for visibility.

@Andy monitor posts from my LinkedIn connections who might need freelance help (CTOs, startup founders, ops engineers). When they post about challenges I can solve, draft a helpful comment suggesting an approach.
```

---

## 🔍 Lead Qualification Skills

### 12. `/add-lead-scorer` - Qualify Opportunities Automatically

**Purpose:** Don't waste time on low-quality leads

**Capabilities:**
- Score leads based on budget, scope, client history
- Research companies/clients automatically
- Flag red flags (scope creep indicators, unrealistic timelines)
- Prioritize based on likelihood of success

**Example Tasks:**
```
@Andy when I share a job posting, research the client. Check their company website, LinkedIn, past job postings, and reviews. Score them 1-10 based on: budget fairness, clear requirements, professional communication, past freelancer ratings. Only alert me about 7+ scores.

@Andy if a job posting has red flags (fixed price + "urgent" + vague scope + low budget), warn me before I spend time on a proposal. Suggest what I'd need to clarify before bidding.

@Andy track my proposal success rates by project type and client characteristics. Tell me which types of projects I win most often so I can focus my bidding strategy.
```

---

## 📊 Business Intelligence Skills

### 13. `/add-market-analyzer` - Stay Ahead of Trends

**Purpose:** Know what skills/services are in demand

**Capabilities:**
- Track freelance job posting trends
- Monitor pricing for similar services
- Identify emerging tools/platforms
- Suggest skill development priorities

**Example Tasks:**
```
@Andy every month, analyze freelance job postings across Upwork, Freelancer, and LinkedIn. Tell me: most in-demand automation tools, average rates for n8n work, which skills are trending up, and where there are gaps I could fill.

@Andy monitor what other freelancers with similar skills are charging. If I'm pricing too low or too high compared to market rates, alert me and suggest adjustments.

@Andy track mentions of new automation tools, platforms, or frameworks in dev communities. If something is gaining traction and complements my skills (like n8n did for no-code), suggest I learn it early to get ahead of demand.
```

---

## 🚀 Quick Win Skills (Easiest to Implement)

### Priority Order for Implementation:

1. **Reddit Monitor** - Easiest, high value, many opportunities
2. **HackerNews Monitor** - Monthly "Who's Hiring" is goldmine
3. **LinkedIn Monitor** - Highest quality leads
4. **GitHub Monitor** - Good for technical credibility
5. **n8n Community Monitor** - Targeted for your niche

---

## 💡 Immediate Actions (Before Building Skills)

### Manual Setup You Can Do Now:

**1. Create Saved Searches:**
- LinkedIn: "n8n developer", "automation consultant", "workflow automation"
- Twitter: Set up lists of potential clients, automation influencers
- Reddit: Subscribe to r/forhire, r/n8n, r/selfhosted

**2. Set Up Monitoring Tasks (Without Skills):**

```
@Andy every morning at 8am, remind me to check:
- Reddit r/forhire top posts
- HackerNews first page for "Ask HN" about automation
- LinkedIn messages and connection requests
- GitHub notifications on my repos

@Andy every Friday at 4pm, remind me to:
- Update my LinkedIn with weekly progress
- Review proposals sent this week
- Plan next week's client outreach
```

**3. Profile Optimization:**

```
@Andy review my LinkedIn profile. Based on my work with BeastMode (bug bounty automation), Auto Blogger (content pipeline), and VPS management, suggest:
- 5 headline variations optimized for freelance automation work
- Skills to emphasize for n8n consulting
- Keywords to include for searchability
- Types of posts I should make for visibility
```

---

## 🎯 90-Day Freelance Ramp-Up Plan

### Month 1: Foundation & Visibility
```
@Andy help me execute this plan:

Week 1-2: Profile & Portfolio
- Update LinkedIn with automation/n8n focus
- Create portfolio page highlighting VPS projects
- Write 2 case studies (BeastMode, Auto Blogger)
- Set up profiles on Upwork, Freelancer

Week 3-4: Community Engagement
- Answer 10 questions on n8n forum
- Share 2 technical posts on LinkedIn
- Create 1 n8n template for community
- Engage on Reddit r/n8n with helpful advice
```

### Month 2: Lead Generation
```
Week 5-6: Active Outreach
- Apply to 20 jobs matching my skills
- Connect with 50 potential clients on LinkedIn
- Share weekly automation tips on Twitter
- Monitor and respond to Reddit opportunities

Week 7-8: Refinement
- Analyze which proposals got responses
- Optimize proposal templates
- Double down on channels with best ROI
- Start building n8n-specific content
```

### Month 3: Scale & Automate
```
Week 9-10: Automation
- Implement top 3 Andy skills for lead gen
- Automate proposal generation
- Set up monitoring tasks for all platforms
- Create content calendar for visibility

Week 11-12: Optimize
- Review success rates by source
- Increase rates based on demand
- Build referral network
- Plan Q2 growth strategy
```

---

## 📈 Success Metrics to Track

Have Andy monitor these:

```
@Andy track my freelance metrics in a spreadsheet:
- Proposals sent per week
- Response rate (%)
- Interview-to-project conversion (%)
- Average project value ($)
- Time from proposal to start (days)
- Client satisfaction (ask me after each project)
- Hourly/project rate trends

Every Sunday, send me a weekly report with trends and suggestions for improvement.
```

---

## 🔥 Highest ROI Quick Win

**Start Here:** Reddit + HackerNews monitoring

```
@Andy every 2 hours, check:
- r/forhire for "automation", "n8n", "API", "security"
- r/n8n for people struggling with complex workflows
- HackerNews "Ask HN" about automation challenges

For each opportunity:
1. Score it 1-10 for fit
2. Draft a response
3. Estimate project value
4. Only send me 8+ scores

This way I only see pre-qualified, high-value leads with draft responses ready.
```

---

**Next Steps:**
1. Pick 2-3 skills to implement first
2. Set up basic monitoring tasks
3. Start building freelance presence
4. Create portfolio content from existing projects

Want me to create any of these skills first? I recommend starting with `/add-reddit-monitor` as it's straightforward and high-value!
