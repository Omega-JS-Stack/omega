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
    const self = this;
    let libraries = self.libraries;
    let ctx = self.ctx;
    let req = self.req;
    let res = self.res;
    let options = self.ctx.request.data;
    let admin = self.Manager.libraries.admin;

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
        action: 'firestore-write',
        // label: '',
      });

      // Options
      options.path = `${options.path || ''}`
      options.document = options.document || {};
      options.options = options.options || {};
      options.options.merge = typeof options.options.merge === 'undefined' ? true : options.options.merge;

      if (!user.roles.admin) {
        response.status = 401;
        response.error = new Error('Unauthenticated, admin required.');
      } else if (!options.path) {
        response.status = 401;
        response.error = new Error('Path parameter required');
      } else {
        await admin.firestore().doc(options.path)
        .set(options.document, options.options)
        .then(r => {
          ctx.log(`Wrote to ${options.path}:`, options.document, options.options)
        })
        .catch(e => {
          response.status = 500;
          response.error = e;
        })
      }

      if (response.status === 200) {
        return res.status(response.status).json(response.data);
      } else {
        ctx.error(response.error)
        return res.status(response.status).send(response.error.message);
      }
    });
  },
}
module.exports = Module;
