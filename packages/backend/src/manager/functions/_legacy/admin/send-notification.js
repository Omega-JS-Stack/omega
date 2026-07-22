let Module = {
  init: async function (Manager, data) {
    this.Manager = Manager;
    this.libraries = Manager.libraries;
    this.ctx = Manager.RouteContext({req: data.req, res: data.res})
    this.req = data.req;
    this.res = data.res

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
      error: null,
    };

    return libraries.cors(req, res, async () => {
      // authenticate admin!
      let user = await ctx.authenticate();

      // Analytics
      let analytics = self.Manager.Analytics({
        ctx: ctx,
        uuid: user.auth.uid,
      })
      .event({
        category: 'admin',
        action: 'send-notification',
        // label: '',
      });

      let payload = self.ctx.request.data.payload || {};

      if (!payload.title || !payload.body) {
        response.status = 400;
        response.error = new Error('Not enough notification parameters supplied.');
        ctx.error(response.error)
        return res.status(response.status).send(response.error.message);
      }

      if (!user.roles.admin) {
        response.status = 401;
        response.error = new Error('Unauthenticated, admin required.');
        ctx.error(response.error)
        return res.status(response.status).send(response.error.message);
      } else {
        await self.getTokens({tags: false});
      }

      ctx.log('Notification', ctx.request.data, response);

      if (response.status === 200) {
        return res.status(response.status).json(response.data);
      } else {
        return res.status(response.status).send(response.error.message);
      }

    });
  },
  getTokens: getTokens,
  sendBatch: sendBatch,
  cleanTokens: cleanTokens,
  deleteToken: deleteToken,
}
module.exports = Module;

// HELPERS //
let path_processing = 'notifications/processing/all/{notificationId}';
let path_subscriptions = 'notifications/subscriptions/all';
let badTokenReasons = ['messaging/invalid-registration-token', 'messaging/registration-token-not-registered']
let batchPromises = [];

function sendBatch(batch, id) {
  let self = this;
  // self.ctx.log(`Sending batch ID: ${id}`, batch);
  self.ctx.log(`Sending batch ID: ${id}`);

  // self.ctx.log('payload', payload);
  return new Promise(async function(resolve, reject) {
    let payload = {};
    payload.notification = {};
    payload.notification.title = self.ctx.request.data.payload.title;
    payload.notification.click_action = self.ctx.request.data.payload.click_action;
    payload.notification.body = self.ctx.request.data.payload.body;
    payload.notification.icon = self.ctx.request.data.payload.icon;

    await self.libraries.admin.messaging().sendToDevice(batch, payload)
      .then(async function (response) {
        // self.result.batches.list.push('#' + id + ' | ' + '✅  ' + response.successCount + ' | ' + '❌  ' + response.failureCount);
        self.ctx.log('Sent batch #' + id);
        // self.result.successes += response.successCount;
        // self.result.failures += response.failureCount;
        // console.log('RESP', response);
        if (response.failureCount > 0) {
          await self.cleanTokens(batch, response.results, id);
        }
        resolve();
      })
      .catch(function (e) {
        self.ctx.error('Error sending batch #' + id, e);
        // self.result.status = 'fail';
        reject(e);
      })
  });
}

function getTokens(options) {
  let self = this;
  options = options || {};
  options.tags = options.tags || false;
  return new Promise(async function(resolve, reject) {
    let subs = self.libraries.admin.firestore().collection(path_subscriptions);
    if (options.tags) {
      subs.where('tags', 'array-contains-any', options.tags)
    }
    await subs
      .get()
      .then(function(querySnapshot) {
        self.ctx.log(`Queried ${querySnapshot.size} tokens.`);
        // self.result.subscriptionsStart = querySnapshot.size;
        let batchCurrentSize = 0;
        let batchSizeMax = 1000;

        let batchCurrent = [];
        let batchLoops = 1;
        batchPromises = [];

        querySnapshot.forEach(function(doc) {
          // log(self, 'loading... ', batchLoops+'/'+querySnapshot.size);
          if ((batchCurrentSize < batchSizeMax - 1) && (batchLoops < querySnapshot.size)) {
            batchCurrent.push(doc.data().token);
            batchCurrentSize++;
          } else {
            let batchId = batchPromises.length + 1;
            batchCurrent.push(doc.data().token);
            batchCurrentSize++;
            console.log(`Got batch ID: ${batchId} with ${batchCurrentSize} tokens.`);
            batchPromises.push(self.sendBatch(batchCurrent, batchId));
            batchCurrent = [];
            batchCurrentSize = 0;
          }
          batchLoops++;
        });
      })
      .catch(function(e) {
        self.ctx.error('Error querying tokens: ', e)
        reject(error);
      });

    await Promise.all(batchPromises)
      .then(function(values) {
        self.ctx.log('Finished all batches.');
      })
      .catch(function(e) {
        self.ctx.error('Error sending batches: ', e)
      });
    resolve();

  });
}

function cleanTokens(batch, results, id) {
  let self = this;
  let cleanPromises = [];
  // self.ctx.log(`Cleaning tokens of batch ID: ${id}`, results);
  self.ctx.log(`Cleaning tokens of batch ID: ${id}`);
  return new Promise(async function(resolve, reject) {
    results.forEach(function (item, index) {
      if (!item.error) { return false; }
      let curCode = item.error.code;
      let token = batch[index];
      self.ctx.log(`Found bad token: ${index} = ${curCode}`);
      if (badTokenReasons.includes(curCode)) {
        cleanPromises.push(self.deleteToken(token, curCode));
      }
    })
    await Promise.all(cleanPromises)
      .catch(function(e) {
        self.ctx.log('error', "Error cleaning failed tokens: ", e);
      });
    resolve();
  });
}

function deleteToken(token, errorCode) {
  let self = this;
  return new Promise(function(resolve, reject) {
    self.libraries.admin.firestore().doc(`${path_subscriptions}/${token}`)
      .delete()
      .then(function() {
        self.ctx.log(`Deleting bad token: ${token} for reason ${errorCode}`);
        resolve();
      })
      .catch(function(error) {
        self.ctx.log('error', `Error deleting bad token: ${token} for reason ${errorCode} because of error ${error}`);
        resolve();
      })
  });
}
