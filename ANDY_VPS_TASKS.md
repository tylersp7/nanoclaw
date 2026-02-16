# Andy VPS Management Tasks

**Created:** February 10, 2026
**Purpose:** Scheduled tasks for monitoring and managing BeastMode and Auto Blogger VPS servers

---

## 📋 Copy-Paste Task Commands

Send these to Andy via WhatsApp (in your self-chat):

---

## 🔍 Daily Monitoring Tasks

### 1. Morning VPS Health Check
```
@Andy every weekday at 8am, check the health of both VPS servers. SSH into beastmode-vps-ts and blogger-vps-ts, check disk usage with "df -h", memory with "free -h", and verify services are running. On beastmode-vps-ts check if BeastMode processes are running, and on blogger-vps-ts check if PM2 services are active with "npx pm2 list". Send me a brief summary of any issues found.
```

### 2. Service Status Check
```
@Andy every day at 10am and 6pm, SSH into blogger-vps-ts and run "npx pm2 list" to check if the api and worker services are running. If any service is stopped or errored, alert me immediately with details.
```

### 3. Disk Space Alert
```
@Andy every day at 9am, check disk usage on both VPS servers. SSH to beastmode-vps-ts and blogger-vps-ts, run "df -h" and alert me if any partition is above 80% full. Include the current usage percentage in your message.
```

---

## 📊 Weekly Review Tasks

### 4. Weekly Git Activity Review (BeastMode)
```
@Andy every Friday at 5pm, SSH into beastmode-vps-ts, go to /opt/bugbounty, and check the git log for the past week with "git log --since='1 week ago' --oneline". Summarize any changes and let me know if there are uncommitted changes with "git status".
```

### 5. Weekly Git Activity Review (Auto Blogger)
```
@Andy every Friday at 5pm, SSH into blogger-vps-ts, go to ~/auto_blogger_vps, and check the git log for the past week with "git log --since='1 week ago' --oneline". Summarize any changes and check for uncommitted changes.
```

### 6. Weekly Performance Report (Auto Blogger)
```
@Andy every Sunday at 8am, SSH into blogger-vps-ts and check the PM2 logs for the past week. Run "npx pm2 logs --lines 100 --nostream" and look for any errors or warnings. Summarize the health of the blogging pipeline and any issues that need attention.
```

---

## 🔄 Maintenance Tasks

### 7. BeastMode Results Check
```
@Andy every Monday and Thursday at 9am, SSH into beastmode-vps-ts, check if there are new results in /opt/bugbounty/reports/ and /opt/bugbounty/evidence/. If there are findings from the weekend or recent scans, give me a brief overview of what was found.
```

### 8. Auto Blogger Content Check
```
@Andy every Tuesday and Friday at 10am, SSH into blogger-vps-ts and check if any blog posts are stuck in "needs_review" status. You can check the database or logs. Let me know if any posts need manual review.
```

### 9. Update Check (Both VPS)
```
@Andy every Sunday at 11pm, SSH into both VPS servers and check for available system updates. On beastmode-vps-ts run "sudo apt update && apt list --upgradable" and on blogger-vps-ts do the same. Summarize if there are critical security updates available.
```

---

## 🚨 Error Monitoring

### 10. BeastMode Error Log Monitor
```
@Andy every day at 6pm, SSH into beastmode-vps-ts and check the latest logs in /opt/bugbounty/logs/ for any errors from today. If there are Python tracebacks or critical errors, alert me with a snippet of the error.
```

### 11. Auto Blogger Error Monitor
```
@Andy every day at 11am and 5pm, SSH into blogger-vps-ts and check PM2 error logs with "tail -50 ~/.pm2/logs/api-error.log" and "tail -50 ~/.pm2/logs/worker-error.log". If there are new errors since the last check, alert me with details.
```

---

## 📈 Deployment Verification

### 12. Post-Deployment Check (Auto Blogger)
```
@Andy after I push code to the auto_blogger_vps repo, wait 10 minutes then SSH into blogger-vps-ts, check if the git repo is up to date with "cd ~/auto_blogger_vps && git status", verify PM2 services restarted successfully with "npx pm2 list", and check recent logs for any startup errors. This is a one-time task, not recurring.
```

### 13. Post-Deployment Check (BeastMode)
```
@Andy after I push code to the vps_bugbounty repo, wait 5 minutes then SSH into beastmode-vps-ts, check if the git repo is up to date with "cd /opt/bugbounty && git status", and verify no Python import errors by running "python3 -m py_compile core/master.py". This is a one-time task, not recurring.
```

---

## 🔐 Security Monitoring

### 14. SSH Login Attempts
```
@Andy every Monday at 9am, SSH into both VPS servers and check for failed SSH login attempts. On both servers run "sudo journalctl -u ssh -S '1 week ago' | grep 'Failed password'" and let me know if there are any unusual patterns or high numbers of attempts.
```

### 15. Tailscale Connection Check
```
@Andy every day at 7am, verify that both VPS servers are online in the Tailscale network. Check with "tailscale status" and alert me if either beastmode-vps-ts or blogger-vps-ts is offline.
```

---

## 📝 Backup Verification

### 16. Database Backup Check (Auto Blogger)
```
@Andy every Wednesday at 10am, SSH into blogger-vps-ts and check if database backups exist. Look for recent backup files or run a test query with "cd ~/auto_blogger_vps && npx prisma db execute --sql 'SELECT COUNT(*) FROM runs'". Alert me if there are database connection issues.
```

### 17. BeastMode Results Backup Reminder
```
@Andy every Sunday at 6pm, remind me to backup BeastMode results. Check how many files are in /opt/bugbounty/reports/ and /opt/bugbounty/evidence/ on beastmode-vps-ts and include the count in your reminder.
```

---

## 🎯 Custom Ad-Hoc Tasks

### 18. On-Demand Full Status Report
```
@Andy when I say "full vps status", SSH into both servers and give me a complete status report including: uptime, disk space, memory usage, CPU load, running services, recent errors, and git status for both repos. Make it comprehensive.
```

### 19. On-Demand Resource Usage
```
@Andy when I say "vps resources", SSH into both servers and show me current resource usage: CPU with "top -bn1 | head -20", memory with "free -h", and disk with "df -h". Format it clearly for both servers.
```

---

## 📱 How to Use These Tasks

**To add a task:**
1. Copy one of the task commands above
2. Open WhatsApp and go to your self-chat
3. Paste and send the message
4. Andy will acknowledge and schedule the task

**To manage tasks:**
```
@Andy list all scheduled tasks
@Andy pause the morning health check task
@Andy resume the disk space alert task
@Andy delete the backup reminder task
```

**To test a task before scheduling:**
```
@Andy (without the schedule part, just ask him to do it once)
Example: @Andy check the health of both VPS servers and send me a summary
```

---

## 🔧 Customization Tips

1. **Adjust timings:** Change times to match your schedule
2. **Add more details:** Make tasks more specific based on what you need
3. **Combine tasks:** Merge similar checks into one comprehensive task
4. **Set priorities:** Use phrases like "alert me immediately" or "this is urgent" for critical tasks
5. **Add context:** Andy can access your local repos, so he can read documentation before checking

---

## ⚠️ Important Notes

- Andy runs from your local machine, so tasks execute from there (not from the VPS)
- All SSH commands will use the Tailscale connections (beastmode-vps-ts, blogger-vps-ts)
- Tasks with sudo commands might require password entry (use admin users when needed)
- For BeastMode, use the automation user (vps_5p16n3fmrgsv) - no sudo needed
- For Auto Blogger, use ops7209 user which has sudo access
- Andy can read your local repo files to understand context before running checks

---

## 🚀 Recommended Starting Set

If you're just getting started, I recommend these 5 tasks first:

1. **Daily Morning Health Check** (#1) - Overview of both systems
2. **Service Status Check** (#2) - Critical for Auto Blogger uptime
3. **Disk Space Alert** (#3) - Prevent storage issues
4. **Weekly Git Review** (#4 & #5) - Stay informed of changes
5. **Error Monitor** (#11) - Catch issues early

Once these are working well, add more based on your needs!
