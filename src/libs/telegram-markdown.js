'use strict';

const MDV2_RE = /([_*\[\]()~`>#+\-=|{}.!\\])/g;

function mdv2(value) {
  return String(value === undefined || value === null ? '' : value).replace(MDV2_RE, '\\$1');
}

module.exports = {
  mdv2,
};
