---
# Migration wiring (was Jekyll _config.yml collection defaults + site config):
# layout/permalink came from `defaults: { type: recipes, values: {...} }`,
# date was Jekyll-implicit, advertising placement is brand config.
# Lives in _recipes/ (was pages/recipes/): a recipe is a content ENTRY whose
# frontmatter IS the document — the 2026-07-19 meta-only page rule moves such
# docs to collection dirs (a mechanical path move; explicit permalink keeps
# the URL byte-identical).
layout: ports/recipe
permalink: /recipes/the-best-brown-butter-chocolate-chip-cookies
date: 2024-06-01
recipe:
  id: 1764775196
  title: "The Best Brown Butter Chocolate Chip Cookies"
  description: "With the perfect chewy and soft texture, rich dark brown sugar and just a hint of spice, these are truly the best brown butter chocolate chip cookies you could ever have."
  course: "Dessert"
  cuisine: "American"
  keywords:
    - brown butter cookies
    - chocolate chip cookies
    - best chocolate chip cookies
    - brown butter chocolate chip cookies
  time:
    prep: 240
    cook: 9
  servings:
    amount: 24
    unit: "cookies"
  calories: 160
  author: "alex-raeburn"
  rating: 4.9
  ingredients:
    - section: "Cookies"
      items:
        - amount: 1
          unit: "cup"
          name: "salted butter"
        - amount: 2.25
          unit: "cups"
          name: "all-purpose flour"
        - amount: 1
          unit: "teaspoon"
          name: "cinnamon"
        - amount: 1
          unit: "teaspoon"
          name: "salt"
        - amount: 1
          unit: "teaspoon"
          name: "baking soda"
        - amount: 1
          unit: "cup"
          name: "dark brown sugar (packed)"
        - amount: 0.5
          unit: "cup"
          name: "white sugar"
        - amount: 2
          unit: "large"
          name: "eggs (room temperature)"
        - amount: 2
          unit: "tablespoons"
          name: "bourbon (optional)"
        - amount: 2
          unit: "teaspoons"
          name: "vanilla extract"
        - amount: 12
          unit: "ounces"
          name: "semi-sweet chocolate chips"
  instructions:
    - section: "Prepare Brown Butter"
      steps:
        - "In a small skillet over medium heat, melt the butter until it begins to foam. Continue to cook and stir frequently until it turns amber in color."
        - "Remove from heat and pour into a small bowl. Scrape the brown bits into the bowl with the melted butter."
        - "Allow the mixture to solidify but remain soft enough to use for cookies. You can place in the refrigerator to speed up the process. This can be done a few days in advance and stored in the refrigerator—just pull it out 30 minutes before using."
    - section: "Make Dough"
      steps:
        - "Stir together flour, cinnamon, salt and baking soda in a small bowl. Set aside."
        - "Cream together the solid brown butter with dark brown sugar and white sugar in a stand mixer or mixing bowl with hand mixer until light and fluffy. If using a KitchenAid stand mixer, use speed 4 for about 4 minutes."
        - "Scrape the creamed butter off the side of the bowl. Add one egg, bourbon if using, and vanilla extract. Beat until combined. Repeat with the second egg. Scrape the dough off the sides again."
        - "Add the flour mixture one spoonful at a time, stirring until incorporated. Repeat until all flour is combined. Stir in chocolate chips."
    - section: "Chill and Bake"
      steps:
        - "Chill the cookie dough in the refrigerator for at least an hour. This dough is softer than typical chocolate chip cookie dough, so chilling is important to prevent overspreading. You can chill for longer if desired, even overnight."
        - "Heat oven to 375°F. On a parchment paper-lined baking sheet, form the dough into golf ball-sized dough balls. Top with additional chocolate chips if desired."
        - "Bake for 9 minutes. Allow to cool on the pan for a couple minutes, then move to a wire rack to cool completely."
        - "Store in an airtight container. Enjoy!"
  notes:
    - "The brown butter can be made a few days in advance and stored in the refrigerator."
    - "These cookies are best when chilled for at least an hour before baking to prevent spreading."
    - "The large dough balls help keep the cookies extra soft."
config:
  advertising:
    providers:
      adsense:
        client: "ca-pub-PORTSTEST"
        displaySlot: "1111111111"
        inArticleSlot: "2222222222"
        multiplexSlot: "3333333333"
---

Nothing beats the aroma and taste of homemade chocolate chip cookies warm from the oven. These **brown butter chocolate chip cookies** take everything you love about classic cookies and elevate them with the rich, nutty depth that only brown butter can provide.

The secret to these incredible cookies is in the brown butter—that amber-colored, nutty liquid that results from slowly cooking butter until its milk solids turn golden brown. Combined with dark brown sugar and a hint of warming spices like cinnamon, each bite delivers a complex flavor that's more sophisticated than traditional chocolate chip cookies, yet still irresistibly chewy and soft.

What makes this recipe special is the texture. The larger-than-average dough balls create cookies that stay impossibly soft in the center while developing just the right amount of crispy edges. At just 9 minutes in the oven, these cookies strike the perfect balance between gooey and baked. Whether you're making them for a special occasion or just because, these brown butter chocolate chip cookies are sure to become your new favorite.
