/** scrypt cost parameters, stored in the safebox header. */
export interface KdfParams {
    /** CPU and memory cost, a power of two. */
    N: number
    /** Block size. */
    r: number
    /** Parallelization. */
    p: number
}
