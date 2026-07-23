# INBOX — omega
> Capture anything, any format. Triage files every entry and empties this (project-state spec v2).

* for web, ensure we have all the boring reauired files like ads.txt, robots.txt, sitemap.xml, feed xml ( thin its /feeds/posts.xml??), and some ones i know we dont have like llms.txt, and any ther new ones

## Web design inspo
https://www.relume.ai/?r=0


## Questions
* should we have omega-managed .claude folder in each monorepo that helps agnents working in onega repos act more determininstically? or should we leave those to skills? remember, i want to have my own workflow optimzied so that workin with omega projects is easier but also anyone who uses omega to be able to take advntage of these thigns too. but also consdier that people will want to customize their own workflows too. so not sure how to do this? maybe some middleground where the .claude fodler has some things always forced/set (like the firebase.josn hosting config with backend-manager/omega rewrites) but then users can set their own? or should they live in the GLOBAL claude so they are always universal??? so basically should this exist at all, and if so should it exist in project .claude, or global .claude? what are the pros and cons of each? should we also register somne omega SKILS the same way? kinda like how right npw we have hooks that deterministicaly load skills, is that even the right approach? condiser how now instead of wokring in seaprate repos were wokring in monorepos for each rband. either way it shoudl be consistent. so if we do decie to have omega setup skills+hooks it should either be GLOBAL or REPO scoped right? same for boht? what are the pros and cons of each?

## Longterm omega manager optimizations
* help guide the user to making backlinks. we could help them generate all the images they need for htings like producthunt launch, etc, coudl go into the SEO service in omega manager? maybe even automate more baclinks similar to how we autlomate github?
