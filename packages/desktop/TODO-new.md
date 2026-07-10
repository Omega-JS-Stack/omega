



BXM
next, weve worked vry hard on a solid test harness for @omegajs/desktop and now BXM. you can also remember that it was copied from BEM. please research and implement a good testing framewrok for UJM: /Users/ian/Developer/Repositories/ITW-Creative-Works/ultimate-jekyll-manager

there is currently zero framekwrok, so please build it from scratch EXACTLY like how our @omegajs/desktop & BXM framework is built allowing for testing nearly everything in the framework itself. obviously its a bit different from @omegajs/desktop, but still it should be powerful and test things from LITTLE to BIG!

----

ok next you should also (JUST LIKE @omegajs/desktop & BXM) ensuer that consumers of UJM vs  can not only write tests but you should also try it in a real project: /Users/ian/Developer/Repositories/Chatsy/chatsy-website/

----


UJM/BXM/@omegajs/desktop TESTING
quick question about things lke bxm and ujm that test in a headless browser... is puppeteer instaleld inside the manager? or as a peer dep or what? what is the most efficient? are we doing whats most efficient?
ANWER: lets go with the peerDeps and th


------

promo-server implementation

---

FRAMEWORK
- MCP: should we have an @omegajs/desktop framework MCP setter upper? kinda liek BEM does? and then the consuming project can tap into it to register handlers? that way we can abstract all of the setup and authentication, etcetera, with our framework and then have the consumer expose the actual juicy parts of the MCP.
