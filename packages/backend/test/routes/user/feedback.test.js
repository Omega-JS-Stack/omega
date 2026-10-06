/**
 * Test: POST /user/feedback
 * Tests the user submit feedback endpoint
 * Requires authentication, saves feedback to Firestore
 * Note: Makes external call to ITW getApp endpoint
 */

const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');
module.exports = defineCases({
  description: 'User submit feedback',
  type: 'group',
  tests: [
    // Test 1: Authenticated user can submit feedback
    {
      name: 'authenticated-user-succeeds',
      auth: 'basic',
      timeout: 30000, // Longer timeout due to external API call

      async run({ http, expect }) {
        const response = await http.post('omega/user/feedback', {
          rating: 'like',
          like: 'Great app! Works well.',
          dislike: '',
        });

        expect(response, 'Submit feedback should succeed for authenticated user').toBeSuccess();
        expect(response, 'Response should contain review decision').toHaveProperty('data.review');
        expect(response, 'Response should contain original request').toHaveProperty('data.originalRequest');
      },
    },

    // Test 2: Feedback with love rating
    {
      name: 'love-rating-succeeds',
      auth: 'basic',
      timeout: 30000,

      async run({ http, expect }) {
        const response = await http.post('omega/user/feedback', {
          rating: 'love',
          like: 'Absolutely love this app! Best thing ever! Highly recommend!',
          dislike: '',
        });

        expect(response, 'Submit feedback with love rating should succeed').toBeSuccess();
        expect(response, 'Response should have promptReview flag').toHaveProperty('data.review.promptReview');
        expect(typeof response.data.review.promptReview === 'boolean', 'promptReview should be a boolean').toBeTruthy();
      },
    },

    // Test 3: Feedback with dislike
    {
      name: 'dislike-feedback-succeeds',
      auth: 'basic',
      timeout: 30000,

      async run({ http, expect }) {
        const response = await http.post('omega/user/feedback', {
          rating: 'dislike',
          like: '',
          dislike: 'Could use some improvements in the UI',
        });

        expect(response, 'Submit negative feedback should succeed').toBeSuccess();
        expect(response, 'Response should contain review decision').toHaveProperty('data.review');
      },
    },

    // Test 4: Premium user can submit feedback
    {
      name: 'premium-user-succeeds',
      auth: 'premium-active',
      timeout: 30000,

      async run({ http, expect }) {
        const response = await http.post('omega/user/feedback', {
          rating: 'like',
          like: 'Premium features are great!',
          dislike: '',
        });

        expect(response, 'Submit feedback should succeed for premium user').toBeSuccess();
      },
    },

    // Test 5: Unauthenticated request fails
    {
      name: 'unauthenticated-rejected',
      auth: 'none',
      timeout: 15000,

      async run({ http, expect }) {
        const response = await http.post('omega/user/feedback', {
          rating: 'like',
          like: 'Test',
          dislike: '',
        });

        expect(response, 'Submit feedback should fail without authentication').toBeError(401);
      },
    },
  ],
});
