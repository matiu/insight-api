'use strict';

var imports            = require('soop').imports();
var async              = require('async');
var bitcore            = require('bitcore');
var BitcoreAddress     = bitcore.Address;
var BitcoreTransaction = bitcore.Transaction;
var BitcoreUtil        = bitcore.util;
var Parser             = bitcore.BinaryParser;
var Buffer             = bitcore.Buffer;
var TransactionDb      = imports.TransactionDb || require('../../lib/TransactionDb').default();
var BlockDb            = imports.BlockDb || require('../../lib/BlockDb').default();
var config              = require('../../config/config');
var CONCURRENCY        = 5;

function Address(addrStr) {
  this.balanceSat        = 0;
  this.totalReceivedSat  = 0;
  this.totalSentSat      = 0;

  this.unconfirmedBalanceSat  = 0;

  this.txApperances           = 0;
  this.unconfirmedTxApperances= 0;
  this.seen                   = {};

  // TODO store only txids? +index? +all?
  this.transactions   = [];

  var a = new BitcoreAddress(addrStr);
  a.validate();
  this.addrStr        = addrStr;
  
  Object.defineProperty(this, 'totalSent', {
    get: function() {
      return parseFloat(this.totalSentSat) / parseFloat(BitcoreUtil.COIN);
    },
    set:  function(i) {
      this.totalSentSat =  i * BitcoreUtil.COIN;
    },
    enumerable: 1,
  });

  Object.defineProperty(this, 'balance', {
    get: function() {
      return parseFloat(this.balanceSat) / parseFloat(BitcoreUtil.COIN);
    },
    set:  function(i) {
      this.balance =   i * BitcoreUtil.COIN;
    },
    enumerable: 1,
  });

  Object.defineProperty(this, 'totalReceived', {
    get: function() {
      return parseFloat(this.totalReceivedSat) / parseFloat(BitcoreUtil.COIN);
    },
    set:  function(i) {
      this.totalReceived =  i * BitcoreUtil.COIN;
    },
    enumerable: 1,
  });


  Object.defineProperty(this, 'unconfirmedBalance', {
    get: function() {
      return parseFloat(this.unconfirmedBalanceSat) / parseFloat(BitcoreUtil.COIN);
    },
    set:  function(i) {
      this.unconfirmedBalanceSat =  i * BitcoreUtil.COIN;
    },
    enumerable: 1,
  });

}


Address.prototype._addTxItem = function(txItem, txList) {
  var add=0, addSpend=0;
  var v = txItem.value_sat;
  var seen = this.seen;

  // Founding tx
  if ( !seen[txItem.txid] ) {
    seen[txItem.txid]=1;
    add=1;

    if (txList)
      txList.push({txid: txItem.txid, ts: txItem.ts});
  }

  // Spent tx
  if (txItem.spentTxId && !seen[txItem.spentTxId]  ) {
    if (txList) {
      txList.push({txid: txItem.spentTxId, ts: txItem.spentTs});
    }
    seen[txItem.spentTxId]=1;
    addSpend=1;
  }
  if (txItem.isConfirmed) {
    this.txApperances += add;
    this.totalReceivedSat += v;
    if (! txItem.spentTxId ) {
      //unspent
      this.balanceSat   += v;
    }
    else if(!txItem.spentIsConfirmed) {
      // unspent
      this.balanceSat   += v;
      this.unconfirmedBalanceSat -= v;
      this.unconfirmedTxApperances += addSpend;
    }
    else {
      // spent
      this.totalSentSat += v;
      this.txApperances += addSpend;
    }
  }
  else {
    this.unconfirmedBalanceSat += v;
    this.unconfirmedTxApperances += add;
  }
};

Address.prototype._setTxs = function(txs) {

  // sort input and outputs togheter
  txs.sort(
    function compare(a,b) {
    if (a.ts < b.ts) return 1;
    if (a.ts > b.ts) return -1;
    return 0;
  });

  this.transactions = txs.map(function(i) { return i.txid; } );
};

Address.prototype.update = function(next, opts) {
  var self = this;
  if (!self.addrStr) return next();
  opts = opts || {};

  var txList  = opts.noTxList ? null : [];
  var tDb   = TransactionDb;
  var bDb   = BlockDb;
  tDb.fromAddr(self.addrStr, function(err,txOut){
    if (err) return next(err);

    bDb.fillConfirmations(txOut, function(err) {
      if (err) return next(err);
      tDb.cacheConfirmations(txOut, function(err) {
        if (err) return next(err);

        txOut.forEach(function(txItem){
          self._addTxItem(txItem, txList);
        });

        if (txList)
          self._setTxs(txList);
        return next();
      });
    });
  });
};

Address.prototype.getUtxo = function(next) {
  var self = this;
  var tDb   = TransactionDb;
  var bDb   = BlockDb;
  var ret;
  if (!self.addrStr) return next(new Error('no error'));

  tDb.fromAddr(self.addrStr, function(err,txOut){
    if (err) return next(err);
    var unspent = txOut.filter(function(x){
      return !x.spentTxId;
    });

    bDb.fillConfirmations(unspent, function() {
      tDb.fillScriptPubKey(unspent, function() {
        ret = unspent.map(function(x){
          return {
            address: self.addrStr,
            txid: x.txid,
            vout: x.index,
            ts: x.ts,
            scriptPubKey: x.scriptPubKey,
            amount: x.value_sat / BitcoreUtil.COIN,
            confirmations: x.isConfirmedCached ? (config.safeConfirmations+'+') : x.confirmations,
          };
        });
        return next(null, ret);
      });
    });
  });
};

module.exports = require('soop')(Address);

