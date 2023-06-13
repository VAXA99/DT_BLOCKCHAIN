var isFibonacci = (num) => {
    if (num === 0) return true;
    var a = 0;
    var b = 1;
    var c = a + b;

    while (c <= num) {
        if (c === num) return true;
        a = b;
        b = c;
        c = a + b;
    }

    return false;
};

var difficulty = 3;

var isMiningConditionMet = (hash) => {
    var firstCharacters = hash.substring(0, difficulty);
    var lastCharacters = hash.substring(hash.length - difficulty);
    console.log(firstCharacters);
    console.log(lastCharacters);
  
    var firstDecimalHash = parseInt(firstCharacters, 16);
    var lastDecimalHash = parseInt(lastCharacters, 16);
    console.log(firstDecimalHash);
    console.log(lastDecimalHash);
    
    if (isFibonacci(firstDecimalHash) === true && isFibonacci(lastDecimalHash) === true && firstDecimalHash === lastDecimalHash) {
        return true;
    }

    return false;

  };

var hash = "00dc2d02e8d1a21098b8e07eb2426e40fb89c833350dc2e5cccac10dba06900d";
console.log(isMiningConditionMet(hash));
