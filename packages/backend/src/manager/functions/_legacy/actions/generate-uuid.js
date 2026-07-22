const uuid = require('uuid');

let Module = {
  init: async function (Manager, data) {
    this.Manager = Manager;
    this.libraries = Manager.libraries;
    this.ctx = Manager.RouteContext({req: data.req, res: data.res})
    this.req = data.req;
    this.res = data.res;

    return this;
  },
  main: async function() {
    let self = this;
    let libraries = self.libraries;
    let ctx = self.ctx;
    let req = self.req;
    let res = self.res;

    let response = {
      status: 200,
      data: {},
    };

    return libraries.cors(req, res, async () => {
      let user = await ctx.authenticate();

      // Analytics
      let analytics = self.Manager.Analytics({
        ctx: ctx,
        uuid: user.auth.uid,
      })
      .event({
        category: 'admin',
        action: 'generate-uuid',
        // label: '',
      });

      const namespace = ctx.request.data.namespace || process.env.OMEGA_NAMESPACE;
      ctx.request.data.version = `${ctx.request.data.version || '5'}`.replace('v', '');
      ctx.request.data.name = ctx.request.data.name || ctx.request.data.input;

      if (!ctx.request.data.name) {
        response.status = 400;
        response.error = new Error('You must provide a name to hash');
      } else if (ctx.request.data.version === '5') {
        response.data.uuid = uuid.v5(ctx.request.data.name, namespace);
      } else if (ctx.request.data.version === '4') {
        response.data.uuid = uuid.v4();
      }

      ctx.log('UUID Generated', ctx.request.data, response);

      if (response.status === 200) {
        return res.status(response.status).json(response.data);
      } else {
        return res.status(response.status).send(response.error.message);
      }
    });
  },
}
module.exports = Module;
