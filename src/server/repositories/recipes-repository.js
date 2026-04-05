'use strict';

const recipesStore = require('../db/recipes-store.js');

module.exports = {
  createRecipe: (...args) => recipesStore.createRecipe(...args),
  searchRecipes: (...args) => recipesStore.searchRecipes(...args),
  getRecipeByPublicId: (...args) => recipesStore.getRecipeByPublicId(...args),
  patchRecipe: (...args) => recipesStore.patchRecipe(...args),
  overwriteRecipe: (...args) => recipesStore.overwriteRecipe(...args),
  linkRecipes: (...args) => recipesStore.linkRecipes(...args),
  appendRecipeNote: (...args) => recipesStore.appendRecipeNote(...args),
  listReviewQueue: (...args) => recipesStore.listReviewQueue(...args),
};
