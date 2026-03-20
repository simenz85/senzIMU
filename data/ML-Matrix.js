function broadcast(matrix1, matrix2) {
    matrix1 = new Matrix(matrix1);
    matrix2 = new Matrix(matrix2);
    var i1 = matrix1.shape()[0];
    var j1 = matrix1.shape()[1];
    var i2 = matrix2.shape()[0];
    var j2 = matrix2.shape()[1];
    matrix1 = matrix1.matrix;
    matrix2 = matrix2.matrix;
    //if two dimensions are the same
    if (i1 === i2 && j1 === j2) {
        return [matrix1, matrix2];
    }
    //if one dimensions is the same, four cases
    // case1: (3, 1); (3, 3)
    else if (i1 === i2 && j1 === 1) {
        var matrixContainer = new Matrix();
        matrixContainer.create([i2, j2], 0);
        for (var i = 0; i < i2; i++) {
            for (var j = 0; j < j2; j++) {
                matrixContainer.matrix[i][j] = matrix1[i][0];
            }
        }
        matrix1 = matrixContainer.matrix;
    }
    // case2: (3, 3); (3, 1)
    else if (i1 === i2 && j2 === 1) {
        var matrixContainer = new Matrix();
        matrixContainer.create([i1, j1], 0);
        for (var i = 0; i < i1; i++) {
            for (var j = 0; j < j1; j++) {
                matrixContainer.matrix[i][j] = matrix2[i][0];
            }
        }
        matrix2 = matrixContainer.matrix;
    }
    // case3: (1, 3); (3, 3)
    else if (j1 === j2 && i1 === 1) {
        var matrixContainer = new Matrix();
        matrixContainer.create([i2, j2], 0);
        for (var i = 0; i < i2; i++) {
            for (var j = 0; j < j2; j++) {
                matrixContainer.matrix[i][j] = matrix1[0][j];
            }
        }
        matrix1 = matrixContainer.matrix;
    }
    // case4: (3, 3); (1, 3)
    else if (j1 === j2 && i2 === 1) {
        var matrixContainer = new Matrix();
        matrixContainer.create([i1, j1], 0);
        for (var i = 0; i < i1; i++) {
            for (var j = 0; j < j1; j++) {
                matrixContainer.matrix[i][j] = matrix2[0][j];
            }
        }
        matrix2 = matrixContainer.matrix;
    }
    //if two dimensions are different, three cases
    else if (i1 !== i2 && j1 !== j2) {
        // case1: (1, 1), (3, 3)
        if (i1 === j1 && j1 === 1) {
            var matrixContainer = new Matrix();
            matrixContainer.create([i2, j2], matrix1[0][0]);
            matrix1 = matrixContainer.matrix;
        }
        // case2: (3, 3), (1, 1)
        else if (i2 === j2 && j2 === 1) {
            var matrixContainer = new Matrix();
            matrixContainer.create([i1, j1], matrix2[0][0]);
            matrix2 = matrixContainer.matrix;
        }
        // case2: (1, 2), (3, 4)
        else {
            throw "Error: unable to boardcast the matrix with dimension (" + i1 + "," + j1 + ") and (" + i2 + "," + j2 + ")";
        }
    } else {
        throw "Error: failed to boardcast the matrix with dimension (" + i1 + "," + j1 + ") and (" + i2 + "," + j2 + ")";
    }
    return [matrix1, matrix2];
}
function Matrix(inputMatrix) {
    if (inputMatrix) {
        try {
            var temp = inputMatrix.matrix;
            if (temp) {
                this.matrix = temp;
            } else {
                throw ".matrix is undefined";
            }
        } catch (e) {
            this.matrix = inputMatrix;
        }
    }
    this.create = function (dimention, container, threshold) {
        var Matrix = new Array();
        for (var idxI = 0; idxI < dimention[0]; idxI++) {
            var matrixSubUnit = new Array();
            for (var idxJ = 0; idxJ < dimention[1]; idxJ++) {
                if (container === +container) {
                    matrixSubUnit.push(container);
                } else {
                    var value = Math.random();
                    if (threshold) {
                        value = value < threshold ? 1 : 0;
                    }
                    matrixSubUnit.push(value);
                }
            }
            Matrix.push(matrixSubUnit);
        }
        this.matrix = Matrix;
    };
    this.shape = function () {
        return [this.matrix.length, this.matrix[0].length];
    };
    this.T = function () {
        var length = this.matrix.length;
        var width = this.matrix[0].length;
        var matrixContainer = new Matrix();
        matrixContainer.create([width, length], 0);
        for (var i = 0; i < length; i++) {
            for (var j = 0; j < width; j++) {
                matrixContainer.matrix[j][i] = this.matrix[i][j];
            }
        }
        return matrixContainer;
    };
    this.inv = function () {
        //if the matrix isn't square: exit (error)
        if (this.matrix.length !== this.matrix[0].length) {
            throw "Error: the matrix isn't square";
        }
        //create the identity matrix (matrixContainer), and a dummy (dummyMatrix) of the original
        var i = 0, ii = 0, j = 0, dim = this.matrix.length, element = 0, t = 0;
        var matrixContainer = new Matrix();
        matrixContainer.create([dim, dim], 0);
        var dummyMatrix = [];
        for (i = 0; i < dim; i += 1) {
            dummyMatrix[dummyMatrix.length] = [];
            for (j = 0; j < dim; j += 1) {
                if (i === j) {
                    matrixContainer.matrix[i][j] = 1;
                } else {
                    matrixContainer.matrix[i][j] = 0;
                }
                dummyMatrix[i][j] = this.matrix[i][j];
            }
        }
        // Perform elementary row operations
        for (i = 0; i < dim; i += 1) {
            element = dummyMatrix[i][i];
            if (element === 0) {
                for (ii = i + 1; ii < dim; ii += 1) {
                    if (dummyMatrix[ii][i] !== 0) {
                        for (j = 0; j < dim; j++) {
                            element = dummyMatrix[i][j];
                            dummyMatrix[i][j] = dummyMatrix[ii][j];
                            dummyMatrix[ii][j] = element;
                            element = matrixContainer.matrix[i][j];
                            matrixContainer.matrix[i][j] = matrixContainer.matrix[ii][j];
                            matrixContainer.matrix[ii][j] = element;
                        }
                        break;
                    }
                }
                element = dummyMatrix[i][i];
                //if the element is still zero: exit (error)
                if (element === 0) {
                    throw "Error: the matrix is not invertable";
                }
            }
            for (j = 0; j < dim; j++) {
                dummyMatrix[i][j] = dummyMatrix[i][j] / element;
                matrixContainer.matrix[i][j] = matrixContainer.matrix[i][j] / element;
            }
            for (ii = 0; ii < dim; ii++) {
                if (ii === i) {
                    continue;
                }
                element = dummyMatrix[ii][i];
                for (j = 0; j < dim; j++) {
                    dummyMatrix[ii][j] -= element * dummyMatrix[i][j];
                    matrixContainer.matrix[ii][j] -= element * matrixContainer.matrix[i][j];
                }
            }
        }
        return matrixContainer;
    };
    this.norm = function () {
        var length = this.matrix.length;
        var width = this.matrix[0].length;
        var matrixContainer = new Matrix();
        matrixContainer.create([1, 1], 0);
        for (var i = 0; i < length; i++) {
            for (var j = 0; j < width; j++) {
                matrixContainer.matrix[0][0] += Math.pow(this.matrix[i][j], 2);
            }
        }
        matrixContainer.matrix[0][0] = Math.pow(matrixContainer.matrix[0][0], 0.5);
        return matrixContainer;
    };
    this.toVector = function () {
        var length = this.matrix.length;
        var width = this.matrix[0].length;
        var matrixContainer = new Matrix();
        matrixContainer.create([length * width, 1], 0);
        var counter = 0;
        for (var i = 0; i < length; i++) {
            for (var j = 0; j < width; j++) {
                matrixContainer.matrix[counter][0] = this.matrix[i][j];
                counter++;
            }
        }
        return matrixContainer;
    };
    this.log = function () {
        var length = this.matrix.length;
        var width = this.matrix[0].length;
        var matrixContainer = new Matrix();
        matrixContainer.create([length, width], 0);
        for (var i = 0; i < length; i++) {
            for (var j = 0; j < width; j++) {
                matrixContainer.matrix[i][j] = Math.log(this.matrix[i][j]);
            }
        }
        return matrixContainer;
    };
    this.shuffle = function (matrix) {
        var length1 = this.matrix.length;
        var width1 = this.matrix[0].length;
        var length2 = matrix.matrix.length;
        for (var j = width1 - 1; j > 0; j--) {
            var random_index = Math.floor(Math.random() * (j + 1));
            for (var i = 0; i < length1; i++) {
                var temp1 = this.matrix[i][j];
                this.matrix[i][j] = this.matrix[i][random_index];
                this.matrix[i][random_index] = temp1;
            }
            for (var i = 0; i < length2; i++) {
                var temp2 = matrix.matrix[i][j];
                matrix.matrix[i][j] = matrix.matrix[i][random_index];
                matrix.matrix[i][random_index] = temp2;
            }
        }
    };
    this.exp = function () {
        var length = this.matrix.length;
        var width = this.matrix[0].length;
        var matrixContainer = new Matrix();
        matrixContainer.create([length, width], 0);
        for (var i = 0; i < length; i++) {
            for (var j = 0; j < width; j++) {
                matrixContainer.matrix[i][j] = Math.exp(this.matrix[i][j]);
            }
        }
        return matrixContainer;
    };
    this.pow = function (power) {
        var length = this.matrix.length;
        var width = this.matrix[0].length;
        var matrixContainer = new Matrix();
        matrixContainer.create([length, width], 0);
        for (var i = 0; i < length; i++) {
            for (var j = 0; j < width; j++) {
                matrixContainer.matrix[i][j] = Math.pow(this.matrix[i][j], power);
            }
        }
        return matrixContainer;
    };
    this.sum = function (axis) {
        var length = this.matrix.length;
        var width = this.matrix[0].length;
        if (axis === 0) {
            var matrixContainer = new Matrix();
            matrixContainer.create([1, width], 0);
            for (var j = 0; j < width; j++) {
                for (var i = 0; i < length; i++) {
                    matrixContainer.matrix[0][j] += this.matrix[i][j];
                }
            }
        } else if (axis === 1) {
            var matrixContainer = new Matrix();
            matrixContainer.create([length, 1], 0);
            for (var i = 0; i < length; i++) {
                for (var j = 0; j < width; j++) {
                    matrixContainer.matrix[i][0] += this.matrix[i][j];
                }
            }
        } else {
            var matrixContainer = new Matrix();
            matrixContainer.create([1, 1], 0);
            for (var i = 0; i < length; i++) {
                for (var j = 0; j < width; j++) {
                    matrixContainer.matrix[0][0] += this.matrix[i][j];
                }
            }
        }
        return matrixContainer;
    };
    this.dot = function (matrix) {
        var i1 = this.matrix.length;
        var j1 = this.matrix[0].length;
        try {
            var i2 = matrix.length;
            var j2 = matrix[0].length;
        } catch (e) {
            matrix = matrix.matrix;
            var i2 = matrix.length;
            var j2 = matrix[0].length;
        }
        if (j1 !== i2) {
            throw "Error: unable to dot the matrix with dimension (" + i1 + "," + j1 + ") and (" + i2 + "," + j2 + ")";
        } else {
            var matrixContainer = new Matrix();
            matrixContainer.create([i1, j2], 0);
            for (var i = 0; i < i1; i++) {
                for (var j = 0; j < j2; j++) {
                    for (var k = 0; k < j1; k++) {
                        matrixContainer.matrix[i][j] += this.matrix[i][k] * matrix[k][j];
                    }
                }
            }
        }
        return matrixContainer;
    };
    this.mul = function (matrix) {
        matrix = broadcast(this.matrix, matrix);
        var length = matrix[0].length;
        var width = matrix[0][0].length;
        var matrixContainer = new Matrix();
        matrixContainer.create([length, width], 0);
        for (var i = 0; i < length; i++) {
            for (var j = 0; j < width; j++) {
                matrixContainer.matrix[i][j] = matrix[0][i][j] * matrix[1][i][j];
            }
        }
        return matrixContainer;
    };
    this.div = function (matrix) {
        matrix = broadcast(this.matrix, matrix);
        var length = matrix[0].length;
        var width = matrix[0][0].length;
        for (var i = 0; i < length; i++) {
            for (var j = 0; j < width; j++) {
                matrix[1][i][j] = matrix[1][i][j] + Math.pow(0.1, 10);
            }
        }
        var matrixContainer = new Matrix();
        matrixContainer.create([length, width], 0);
        for (var i = 0; i < length; i++) {
            for (var j = 0; j < width; j++) {
                matrixContainer.matrix[i][j] = matrix[0][i][j] / matrix[1][i][j];
            }
        }
        return matrixContainer;
    };
    this.add = function (matrix) {
        matrix = broadcast(this.matrix, matrix);
        var length = matrix[0].length;
        var width = matrix[0][0].length;
        var matrixContainer = new Matrix();
        matrixContainer.create([length, width], 0);
        for (var i = 0; i < length; i++) {
            for (var j = 0; j < width; j++) {
                matrixContainer.matrix[i][j] = matrix[0][i][j] + matrix[1][i][j];
            }
        }
        return matrixContainer;
    };
    this.minus = function (matrix) {
        matrix = broadcast(this.matrix, matrix);
        var length = matrix[0].length;
        var width = matrix[0][0].length;
        var matrixContainer = new Matrix();
        matrixContainer.create([length, width], 0);
        for (var i = 0; i < length; i++) {
            for (var j = 0; j < width; j++) {
                matrixContainer.matrix[i][j] = matrix[0][i][j] - matrix[1][i][j];
            }
        }
        return matrixContainer;
    };
    this.show = function () {
        var dim = this.matrix.length;
        for (var i = 0; i < dim; i++) {
            print(this.matrix[i]);
        }
    };
}
