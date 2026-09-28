## 题意

面试官常说："商品详情页要调用用户、商品、库存、推荐等多个下游服务，串行调用太慢了，怎么并行调用再汇总？如果某个服务很慢或者报错怎么办？"要实现的是：多个远程调用并行发起，总耗时接近最慢的那个而不是求和；整体有超时上限；单个服务失败或超时时用降级值兜底，不影响整体返回。

## 思路

**面试官想考什么**：会不会用 `CompletableFuture` 编排异步任务；是否知道要用**自定义线程池**；超时和异常如何处理；对 `Future.get` 阻塞的理解。

| 方案 | 做法 | 优点 | 缺点 |
|---|---|---|---|
| 串行调用 | 一个接一个调 | 简单 | 总耗时 = 各服务耗时之和 |
| 线程池 + Future 列表 | submit 后依次 `get(timeout)` | JDK 5 就有 | 超时要自己算剩余时间，组合与降级写起来啰嗦 |
| `ExecutorService.invokeAll(tasks, timeout)` | 一次性提交，整体超时后未完成的自动取消 | 整体超时语义清晰 | 单个任务的降级需要逐个判断 |
| CountDownLatch | 每个任务完成后 countDown，主线程 `await(timeout)` | 通用 | 结果收集要自己用并发容器 |
| CompletableFuture | `supplyAsync` + `completeOnTimeout`/`exceptionally` + `allOf` | 声明式组合，单任务超时和降级都很自然 | 默认用 ForkJoin 公共池，必须传自定义线程池 |

:::tip 关键点
每个调用都用 `supplyAsync(task, 自定义线程池)` 发起，然后**给每个 future 单独挂上 `completeOnTimeout(降级值, 超时)` 和 `exceptionally(ex -> 降级值)`**，这样每个 future 最终一定会正常完成；再用 `CompletableFuture.allOf(...).join()` 等全部完成并汇总。不传线程池时会用 `ForkJoinPool.commonPool()`，它的线程数约为 CPU 核数 - 1，被阻塞型 IO 占满后会拖慢整个 JVM 里所有用公共池的地方（包括 parallelStream）。
:::

下面代码模拟 4 个服务：user 100ms、product 150ms、stock 抛异常、recommend 2s（超时）。并行 + 每个任务 300ms 超时后，整体约 300ms 返回，stock 和 recommend 走降级；另给出 `invokeAll` 版本作为对比。

## Java 题解

```java
import java.util.*;
import java.util.concurrent.*;
import java.util.function.*;

public class ParallelCallsAggregate {
    // 模拟一次远程调用：sleep 若干毫秒后返回，或者直接抛异常
    static String call(String name, long millis, boolean fail) {
        try {
            Thread.sleep(millis);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new CompletionException(e);
        }
        if (fail) throw new IllegalStateException(name + " 500");
        return name + "-ok";
    }

    record Svc(String name, long millis, boolean fail) {}

    static final List<Svc> SERVICES = List.of(
            new Svc("user", 100, false),
            new Svc("product", 150, false),
            new Svc("stock", 50, true),          // 出错
            new Svc("recommend", 2000, false));  // 太慢

    // 方案一：CompletableFuture，每个任务独立超时 + 降级
    static Map<String, String> aggregateWithCF(ExecutorService pool, long timeoutMs) {
        Map<String, CompletableFuture<String>> futures = new LinkedHashMap<>();
        for (Svc s : SERVICES) {
            CompletableFuture<String> f = CompletableFuture
                    .supplyAsync(() -> call(s.name(), s.millis(), s.fail()), pool) // 必须指定业务线程池
                    .completeOnTimeout(s.name() + "-timeout-default", timeoutMs, TimeUnit.MILLISECONDS)
                    .exceptionally(ex -> s.name() + "-error-default"); // 异常降级
            futures.put(s.name(), f);
        }
        // 所有 future 都保证正常完成，allOf 不会抛异常
        CompletableFuture.allOf(futures.values().toArray(new CompletableFuture[0])).join();
        Map<String, String> result = new LinkedHashMap<>();
        futures.forEach((k, v) -> result.put(k, v.join()));
        return result;
    }

    // 方案二：invokeAll 整体超时，超时的任务会被 cancel
    static Map<String, String> aggregateWithInvokeAll(ExecutorService pool, long timeoutMs) throws InterruptedException {
        List<Callable<String>> tasks = new ArrayList<>();
        for (Svc s : SERVICES) tasks.add(() -> call(s.name(), s.millis(), s.fail()));
        List<Future<String>> fs = pool.invokeAll(tasks, timeoutMs, TimeUnit.MILLISECONDS);
        Map<String, String> result = new LinkedHashMap<>();
        for (int i = 0; i < fs.size(); i++) {
            String name = SERVICES.get(i).name();
            Future<String> f = fs.get(i);
            try {
                result.put(name, f.isCancelled() ? name + "-timeout-default" : f.get());
            } catch (ExecutionException e) {
                result.put(name, name + "-error-default");
            }
        }
        return result;
    }

    public static void main(String[] args) throws Exception {
        // 业务专用线程池：有界队列 + 明确的拒绝策略
        ExecutorService pool = new ThreadPoolExecutor(8, 8, 60, TimeUnit.SECONDS,
                new ArrayBlockingQueue<>(100), new ThreadPoolExecutor.CallerRunsPolicy());
        try {
            long serial = SERVICES.stream().mapToLong(Svc::millis).sum();
            long t0 = System.currentTimeMillis();
            Map<String, String> r1 = aggregateWithCF(pool, 300);
            long cost1 = System.currentTimeMillis() - t0;
            System.out.println("CF        : " + r1 + " cost=" + cost1 + "ms (serial would be " + serial + "ms)");

            t0 = System.currentTimeMillis();
            Map<String, String> r2 = aggregateWithInvokeAll(pool, 300);
            long cost2 = System.currentTimeMillis() - t0;
            System.out.println("invokeAll : " + r2 + " cost=" + cost2 + "ms");

            Map<String, String> expected = Map.of("user", "user-ok", "product", "product-ok",
                    "stock", "stock-error-default", "recommend", "recommend-timeout-default");
            if (!r1.equals(expected) || !r2.equals(expected) || cost1 > 1000 || cost2 > 1000)
                throw new AssertionError("unexpected");
            System.out.println("OK");
        } finally {
            pool.shutdownNow(); // 中断仍在 sleep 的慢调用，让 JVM 及时退出
        }
    }
}
```

## 复杂度

- 时间：串行约为 Σ tᵢ（示例 2300ms），并行约为 min(max tᵢ, 超时)（示例约 300ms）。
- 资源估算：每个请求同时占用 k 个线程（k 为下游数）。若接口 QPS 为 500、k = 4、平均下游耗时 100ms，按利特尔法则同时在途的调用数 ≈ 500 × 4 × 0.1 = 200，线程池核心线程数要在 200 左右或改用异步 IO 客户端，否则任务会在队列中排队，并行的收益被排队时间抵消。
- 空间：每个请求 O(k) 个 future 与结果。

## 易错点

- `supplyAsync` 不传线程池：阻塞型 IO 占满 `ForkJoinPool.commonPool()`，影响全局。
- 用 `allOf(...).get()` 却没给单个任务加降级：任何一个任务异常，整体 `join()` 抛 `CompletionException`，其他成功的结果也拿不到。
- `completeOnTimeout` / `orTimeout` 只是让 future 提前完成，**不会中断**正在执行的任务，慢调用仍占着线程；真正的超时还应在 HTTP/RPC 客户端上配置连接和读超时。
- 串行地对每个 future 调 `get(300ms)`：总超时可能变成 300ms × k，应该用整体截止时间计算剩余时间，或用 `invokeAll`。
- 在任务里吞掉 `InterruptedException` 不恢复中断标志，`shutdownNow()` 无法让线程退出。
- 线程池使用无界队列：下游变慢时任务无限堆积，最终 OOM。

## 追问

:::details thenApply、thenCompose、thenCombine 有什么区别？
`thenApply` 对结果做同步转换（类似 map）；`thenCompose` 用结果再发起一个异步调用并展开，避免 `CompletableFuture<CompletableFuture<T>>`（类似 flatMap）；`thenCombine` 把两个独立 future 的结果合并。带 `Async` 后缀的版本会把回调提交到线程池执行。
:::

:::details 如果只要最快的一个结果（比如多机房冗余调用）怎么办？
用 `CompletableFuture.anyOf(...)`，或 `ExecutorService.invokeAny(tasks)`：后者返回第一个成功完成的结果，并取消其余任务。
:::

:::details 调用链的 traceId / 用户上下文在异步线程里丢了怎么办？
ThreadLocal 不会自动传到线程池线程。需要在提交任务时捕获上下文、在任务执行前后设置和清理（包装 Runnable/Callable），或使用阿里开源的 TransmittableThreadLocal 之类的工具。MDC 日志上下文同理。
:::

:::details 下游有 20 个服务，其中 3 个是核心的，怎么设计？
区分强依赖和弱依赖：核心服务失败就整体失败（或重试），弱依赖失败降级为空或缓存数据；不同服务用不同线程池做隔离（舱壁模式），避免一个慢服务拖垮所有调用；配合熔断，在错误率过高时直接走降级不再调用。
:::

## 举一反三

- [[algo:simple-thread-pool]]：理解线程池参数，才能为并行调用配好核心线程数和队列。
- [[algo:rate-limiter]]：并行调用会把流量放大 k 倍，下游往往需要限流保护。
- [[algo:producer-consumer]]：线程池 = 任务队列 + 工作线程。
- JDK 对应：`CompletableFuture`（JDK 8），`completeOnTimeout`/`orTimeout` 是 JDK 9 新增的；`ExecutorService.invokeAll(tasks, timeout, unit)` 超时后会取消未完成的任务。

## 一句话记忆

`supplyAsync(任务, 自定义线程池)` 并行发起，每个 future 挂超时和异常降级，`allOf` 等全部完成再汇总；总耗时取决于最慢的那个。
