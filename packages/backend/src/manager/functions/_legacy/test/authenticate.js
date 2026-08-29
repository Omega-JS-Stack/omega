const { projectUserForLog } = require('../../../helpers/middleware.js');

let Module = {
  init: async function (Manager, data) {
    this.Manager = Manager;
    this.libraries = Manager.libraries;
    this.req = data.req;
    this.res = data.res
    this.ctx = Manager.RouteContext({req: data.req, res: data.res}, {accept: 'json'});

    return this;
  },
  main: async function() {
    let self = this;
    let req = self.req;
    let res = self.res;
    let libraries = self.libraries;
    let ctx = self.ctx;

    return libraries.cors(req, res, async () => {
      let user = await ctx.authenticate();

      // Analytics
      let analytics = self.Manager.Analytics({
        ctx: ctx,
        uuid: user.auth.uid,
      })
      .event({
        name: 'authenticate-test',
        params: {},
      });

      ctx.log('Request:', ctx.request.data);
      ctx.log('Result user:', projectUserForLog(user));
      return res.status(200).json({status: 200, user: user });
    });
  }
}

module.exports = Module;
