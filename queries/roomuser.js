var roomUserProduct = require('../models/roomuser');
var _ = require('lodash');
exports.add = function (product) {
  return product.save()
    .then(function (product) {
      return product;
    })
    .catch(function (err) {
      console.log(err);
    });
};

exports.find = function (options) {
  return roomUserProduct.find(options)
    .then(function (res) {
      return res;
    })
    .catch(function (err) {
      console.log(err);
    });
};

exports.remove = function (options) {
  return roomUserProduct.find(options).remove()
    .then(function (res) {
      return res;
    })
    .catch(function (err) {
      console.log(err);
    });
};

//
// exports.findTwoID = function (input) {
//   var options = {};
//   options.userId = input.userId1;
//   return roomUserProduct.find(options)
//     .then(function (res) {
//       var len = 0;
//       for (var i = 0; i < res.length; i++) {
//         var options2 = {};
//         options2.userId = input.userId2;
//         options2.roomId = res[i].roomId;
//         return roomUserProduct.find(options2)
//           .then(function (resz) {
//             if (resz.length > 0) {
//               console.log(resz);
//               return resz;
//             }
//           })
//           .catch(function (err) {
//             console.log(err);
//           });
//       }
//       if (res.length == 0) return {};
//     })
//     .catch(function (err) {
//       console.log(err);
//     });
// };
