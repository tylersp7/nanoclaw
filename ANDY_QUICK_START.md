# Quick Start: 5 Essential VPS Tasks for Andy

**Send these 5 messages to Andy in WhatsApp to get started:**

---

## 1️⃣ Daily Morning Health Check
```
@Andy every weekday at 8am, check the health of both VPS servers. SSH into beastmode-vps-ts and blogger-vps-ts, check disk usage with "df -h", memory with "free -h", and verify services are running. On beastmode-vps-ts check if BeastMode processes are running, and on blogger-vps-ts check if PM2 services are active with "npx pm2 list". Send me a brief summary of any issues found.
```

---

## 2️⃣ Critical Service Monitor (Auto Blogger)
```
@Andy every day at 10am and 6pm, SSH into blogger-vps-ts and run "npx pm2 list" to check if the api and worker services are running. If any service is stopped or errored, alert me immediately with details.
```

---

## 3️⃣ Disk Space Alert
```
@Andy every day at 9am, check disk usage on both VPS servers. SSH to beastmode-vps-ts and blogger-vps-ts, run "df -h" and alert me if any partition is above 80% full. Include the current usage percentage in your message.
```

---

## 4️⃣ Error Monitor (Auto Blogger)
```
@Andy every day at 11am and 5pm, SSH into blogger-vps-ts and check PM2 error logs with "tail -50 ~/.pm2/logs/api-error.log" and "tail -50 ~/.pm2/logs/worker-error.log". If there are new errors since the last check, alert me with details.
```

---

## 5️⃣ Weekly Git Review (Both VPS)
```
@Andy every Friday at 5pm, SSH into beastmode-vps-ts, go to /opt/bugbounty, and check the git log for the past week with "git log --since='1 week ago' --oneline". Then SSH into blogger-vps-ts, go to ~/auto_blogger_vps and do the same. Summarize any changes on both servers and let me know if there are uncommitted changes with "git status".
```

---

## 🎯 To Add These Tasks:

1. Open WhatsApp
2. Go to your self-chat (message yourself)
3. Copy and paste each task above, one at a time
4. Wait for Andy to confirm each task is scheduled

---

## 📋 To Check Your Tasks Later:

```
@Andy list all scheduled tasks
```

---

## 🔧 To Test Before Scheduling:

Want to test one before scheduling? Just ask Andy without the schedule part:

```
@Andy check the health of both VPS servers and send me a summary
```

---

## 📚 More Tasks Available:

See `ANDY_VPS_TASKS.md` for 19 total tasks including:
- BeastMode scan results monitoring
- Security alerts (failed SSH attempts)
- Tailscale connection verification
- Backup reminders
- On-demand status reports
- And more!

---

**Ready to get started? Copy the 5 tasks above to Andy now!** 🚀
