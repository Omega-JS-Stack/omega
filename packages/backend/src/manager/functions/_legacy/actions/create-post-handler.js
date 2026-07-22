let Poster;
let pathApi;
let os;
// let JSON5;
// Native fetch (Node 22+)
const Mailchimp = require('mailchimp-api-v3');

let Module = {
  init: async function (Manager, data) {
    const self = this;
    self.Manager = Manager;
    self.libraries = Manager.libraries;
    self.ctx = Manager.RouteContext({req: data.req, res: data.res});
    self.req = data.req;
    self.res = data.res;

    return self;
  },
  main: async function() {
    let self = this;
    let libraries = self.libraries;
    let ctx = self.ctx;
    let req = self.req;
    let res = self.res;
    let mailchimp;

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
        action: 'post-created',
        // label: '',
      });

      ctx.log('Creating campagin with data', ctx.request.data)

      if (!user.roles.admin) {
        response.status = 401;
        response.error = new Error('Unauthenticated, admin required.');
        ctx.error(response.error)
      } else {
        mailchimp = new Mailchimp(self.Manager.config?.mailchimp?.key ?? '');
        await fetch(`${self.Manager.getApiUrl()}/omega`, {
          method: 'POST',
          response: 'json',
          headers: {
            'omega-admin-key': process.env.OMEGA_ADMIN_KEY,
          },
          body: {
            command: 'admin:send-notification',
            payload: {
              notification: {
                title: 'New blog post!',
                clickAction: ctx.request.data.url,
                body: `"${ctx.request.data.title}" was just published on our blog. It's a great read and we think you'll enjoy the content!`,
                icon: ctx.request.data.imageUrl,
              },
            },
          },
        })
        .then(res => {
          if (res.status >= 200 && res.status < 300) {
            res.json()
            .then(function (data) {
              ctx.log('Push notification response', data)
            })
          } else {
            return res.text()
            .then(function (data) {
              throw new Error(data || res.statusTest || 'Unknown error.')
            })
          }
        })
        .catch(e => {
          ctx.error('Failed to send push notification', e);
        })
        return res.send('DONE');
        await mailchimp.post(`/campaigns`, {
          "type": "regular",
        	"recipients": {
        		"list_id": self.Manager.config?.mailchimp?.list_id ?? '',
        	},
        	"settings": {
        		"subject_line": `${ctx.request.data.title}`,
        		// "preview_text": "",
        		"title": `Blog post: "${ctx.request.data.title}"`,
        		"from_name": self.Manager.config?.brand?.name,
        		"reply_to": self.Manager.config?.brand?.email,
        		"use_conversation": false,
        		"to_name": "*|FNAME|*",
        		// "folder_id": "",
        		"authenticate": false,
        	},
        })
        .then(async (campaign) => {
          ctx.log('Created campaign', campaign);
          await fetch(`https://email.itwcreativeworks.com/general/mailchimp-blog-syndication?cb=${Math.random()}`)
          .then(async (fetchResponse) => {
            if (fetchResponse.status >= 200 && fetchResponse.status < 300) {
              let html = await fetchResponse.text();
              html = html
                .replace(/{ENTRY_TITLE}/g, ctx.request.data.title)
                .replace(/{ENTRY_URL}/g, ctx.request.data.url)
                .replace(/{ENTRY_IMAGE_URL}/g, ctx.request.data.imageUrl)
                .replace(/{ENTRY_CONTENT}/g, (ctx.request.data.content || '').split('\n')[0])
                .replace(/{ENTRY_PUBLISHED}/g, ctx.request.data.published)
                .replace(/{ENTRY_AUTHOR}/g, ctx.request.data.author)
                .replace(/{ENTRY_TAGS}/g, ctx.request.data.tags)
                .replace(/{BRAND_NAME}/g, self.Manager.config?.brand?.name)
                .replace(/{BRAND_LOGO_COMBOMARK}/g, self.Manager.config?.brand?.combomark)
                .replace(/{BRAND_LOGO_WORDMARK}/g, self.Manager.config?.brand?.wordmark)
              // ctx.log('Resolved email', html);
              await mailchimp.put(`/campaigns/${campaign.id}/content`, {
                "content": 'regular',
              	"html": html,
              })
              .then(async (content) => {
                await mailchimp.post(`/campaigns/${campaign.id}/actions/send`)
                ctx.log('Mailchimp campaign created and sent', campaign);
              })
            } else {
              throw new Error('Failed to fetch.');
            }
          })
        })
        .catch(e => {
          // ctx.error('Failed to send Mailchimp campaign', e);
          ctx.error('Failed to send Mailchimp campaign');
        })
      }

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
// function callMailChimp(options) {
//
// }
//
// function addToMCList(key, listId, email) {
//   return new Promise((resolve, reject) => {
//     let datacenter = key.split('-')[1];
//     fetch = require('node-fetch');
//     fetch(`https://${datacenter}.api.mailchimp.com/3.0/lists/${listId}/members`, {
//         method: 'post',
//         body: JSON.stringify({
//           email_address: email,
//           status: 'subscribed',
//         }),
//         timeout: 10000,
//         headers: {
//           'Content-Type': 'application/json',
//           'Authorization': `Basic ${key}`,
//         },
//       })
//       .then(res => res.json())
//       .then(json => {
//         if (json.status !== 'subscribed') {
//           return reject(new Error(json.status));
//         }
//         return resolve(json);
//       })
//       .catch(e => {
//         return reject(e);
//       })
//
//   });
// }
