const { sourceRepo } = require('@omega.js/config');
const { resolveWebTarget } = require('../../../helpers/web-target.js');
const env = require('../../../libraries/env.js');
let fetch;
let Poster;
let pathApi;
let os;
let Module = {
  init: async function (Manager, data) {
    this.Manager = Manager;
    this.libraries = Manager.libraries;
    this.ctx = Manager.RouteContext({req: data.req, res: data.res});
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
        action: 'create-post',
        // label: '',
      });

      const source = sourceRepo(self.Manager.config) || {};
      let repoInfo = { owner: source.owner, name: source.name };

      if (!user.roles.admin) {
        response.status = 401;
        response.error = new Error('Unauthenticated, admin required.');
        ctx.error(response.error)
      } else {
        // WHICH website the post belongs to (#887): every path below is
        // composed inside this target's folder
        let target;
        try {
          target = resolveWebTarget(self.Manager.config, ctx.request.data.target);
        } catch (e) {
          ctx.error(e);
          return res.status(e.code || 400).send(e.message);
        }

        // Poster = Poster || require('/Users/ianwiedenman/Documents/GitHub/ITW-Creative-Works/ultimate-jekyll-poster');
        Poster = Poster || require('ultimate-jekyll-poster');

        let poster = new Poster();

        // Save to disk OR commit
        poster.onDownload = async function (meta) {
          return new Promise(async function(resolve, reject) {
            let finalPath = `${target.path}/${poster.removeDirDot(meta.finalPath)}`;
            let tempPath = (meta.tempPath);
            await createFile(repoInfo.owner, repoInfo.name, env.get('GH_TOKEN'), finalPath, await poster.readImage(tempPath))
            .catch((e) => {
              // console.log('---CAUGHT 1', e);
            })
            resolve();
          });
        }

        let finalPost = await poster.create(ctx.request.data);

        // Save post OR commit
        await createFile(repoInfo.owner, repoInfo.name, env.get('GH_TOKEN'), `${target.path}/${poster.removeDirDot(finalPost.path)}`, finalPost.content)
        .catch((e) => {
          response.status = 400;
          response.error = new Error('Failed to post: ' + e);
          ctx.error(response.error)
        })
      }

      ctx.log('Post', ctx.request.data, response);

      if (response.status === 200) {
        return res.status(response.status).json(response.data);
      } else {
        return res.status(response.status).send(response.error.message);
      }
    });
  }
}
module.exports = Module;

// HELPERS //
async function createFile(repoOwner, repoName, key, path, contents) {
  pathApi = pathApi || require('path');
  let fileParsed = pathApi.parse(path);

  let base64Data = Buffer.from(contents).toString('base64');
  // base64Data = contents;
  // console.log('--------base64Data', base64Data);
  return new Promise(async (resolve, reject) => {
    let sha;
    try {

      let branch = (repoName === 'ultimate-jekyll') ? 'template' : 'master';

      let pathGet = `https://api.github.com/repos/${repoOwner}/${repoName}/git/trees/${branch}:${encodeURIComponent(pathApi.dirname(path))}`;
      await makeRequest({
        method: 'GET',
        url: pathGet,
        body: {
        },
        timeout: 30000,
        response: 'json',
        headers: {
          'User-Agent': repoOwner,
          'Authorization': `Basic ${Buffer.from(repoOwner + ':' + key).toString('base64')}`,
        }
      })
      .then(function (resp) {
        // sha = resp.sha;
        sha = resp.tree.find(function (element) {
          // console.log('checiing', element.path, fileParsed.base);
          return element.path === fileParsed.base;
        });
        sha = sha.sha;
      });
  } catch (e) {
    sha = null;
  }

  let pathPut = `https://api.github.com/repos/${repoOwner}/${repoName}/contents/${path}`;
  let writeRequest =
  {
    // url: `https://api.github.com/repos/:owner/:repo/contents/:path`,
    method: 'PUT',
    url: pathPut,
    body: {
      message: `BackendManager Post: ${new Date().toISOString()}`,
      content: base64Data,
    },
    timeout: 30000,
    response: 'json',
    headers: {
      'User-Agent': repoOwner,
      'Authorization': `Basic ${Buffer.from(repoOwner + ':' + key).toString('base64')}`,
    }
  }
  if (sha) {
    writeRequest.body.sha = sha;
  }
  // console.log('--------PUT', pathPut);
  await makeRequest(writeRequest)
  .then((json) => {
    if (!json || (json.message && (json.message === 'Not Found' || json.message.includes('Invalid request'))) ) {
      return reject(new Error(json.message));
    }
  })
  .catch((e) => {
    return reject(e);
  })
  return resolve(true)
  });
}

function makeRequest(options) {
  return new Promise(function(resolve, reject) {
    // Native fetch (Node 22+)
    options.headers = options.headers || {};
    options.headers['Content-Type'] = 'application/json';
    let hasBody = Object.keys(options.body || {}).length > 0
    fetch(options.url, {
        method: options.method,
        body: hasBody ? JSON.stringify(options.body) : undefined,
        timeout: 30000,
        headers: options.headers,
        auth: options.auth,
      })
      .then(res => res.json())
      .then(json => {
        return resolve(json);
      })
      .catch(e => {
        // console.error('e', e);
        return reject(e);
      })

  });
}


// function makeRequest(options) {
//   return new Promise(function(resolve, reject) {
//     request = request || require('request');
//     request(options,
//       function (err, httpResponse, body) {
//         if (err) {
//           // console.log('ERROR', err);
//           reject(err);
//         } else {
//           // console.log('SUCCESS', body);
//           resolve(body);
//         }
//       }
//     );
//   });
// }
