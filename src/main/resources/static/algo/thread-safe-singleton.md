## 题意

面试官常说："手写一个线程安全的单例，要求懒加载。"写完双重检查锁（DCL）后，几乎一定会追问：`volatile` 能不能去掉、为什么；还有哪些写法；怎么防反射和反序列化破坏。要实现的是：多线程并发第一次获取时也只创建一个实例。

## 思路

**面试官想考什么**：类加载与初始化的线程安全保证、`synchronized` 的开销、指令重排序与 `volatile` 的 happens-before 语义。

| 写法 | 懒加载 | 线程安全 | 说明 |
|---|---|---|---|
| 饿汉式（static final 字段） | 否 | 是 | 类初始化由 JVM 加锁保证只执行一次；实例用不到也会创建 |
| 懒汉式 + synchronized 方法 | 是 | 是 | 每次获取都加锁，高并发下有性能损耗 |
| 双重检查锁 DCL + volatile | 是 | 是 | 只有首次创建时加锁；**必须 volatile** |
| 静态内部类 Holder | 是 | 是 | 外部类加载时不初始化 Holder，第一次访问才初始化，简洁推荐 |
| 枚举 | 否（随枚举类初始化） | 是 | 天然防反射、防反序列化，《Effective Java》推荐 |

:::tip 关键点
`instance = new Singleton()` 不是原子操作，大致分三步：①分配内存 ②执行构造函数初始化 ③把引用赋给 instance。没有 volatile 时 ②③ 可能被重排序：线程 A 先赋值了引用但还没初始化完，线程 B 在第一次检查（锁外）看到 `instance != null`，直接拿去用，读到的是**半初始化对象**。`volatile` 写禁止与之前的写重排，并且 volatile 写 happens-before 之后对它的读，所以 B 看到非 null 时构造一定已经完成。
:::

下面代码同时实现 DCL、Holder、枚举三种写法，main 里用 64 个线程在 `CountDownLatch` 同一时刻并发获取，重复 200 轮，校验每种写法都只构造了一次、所有线程拿到的是同一个对象；最后演示反射能破坏 DCL 单例但破坏不了枚举。

## Java 题解

```java
import java.lang.reflect.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import java.util.function.*;

// 写法一：双重检查锁
class DclSingleton {
    static final AtomicInteger CREATED = new AtomicInteger(); // 仅用于演示统计构造次数
    private static volatile DclSingleton instance; // volatile 防止重排序导致拿到半初始化对象

    private DclSingleton() { CREATED.incrementAndGet(); }

    public static DclSingleton getInstance() {
        DclSingleton local = instance;       // 只读一次 volatile，减少开销
        if (local == null) {                 // 第一次检查：已创建就不加锁
            synchronized (DclSingleton.class) {
                local = instance;
                if (local == null) {         // 第二次检查：防止多个线程排队进来重复创建
                    instance = local = new DclSingleton();
                }
            }
        }
        return local;
    }

    static void resetForTest() { instance = null; } // 仅供演示重复测试
}

// 写法二：静态内部类，利用类初始化的线程安全 + 懒加载
class HolderSingleton {
    static final AtomicInteger CREATED = new AtomicInteger();
    private HolderSingleton() { CREATED.incrementAndGet(); }

    private static class Holder {
        static final HolderSingleton INSTANCE = new HolderSingleton(); // 首次访问 Holder 时才初始化
    }

    public static HolderSingleton getInstance() { return Holder.INSTANCE; }
}

// 写法三：枚举
enum EnumSingleton {
    INSTANCE;
    public String hello() { return "hi from enum"; }
}

public class ThreadSafeSingleton {
    // 64 个线程在同一时刻并发调用 getter，返回拿到的不同实例个数
    static int concurrentDistinct(Supplier<Object> getter) throws Exception {
        int n = 64;
        ExecutorService pool = Executors.newFixedThreadPool(n);
        CountDownLatch start = new CountDownLatch(1);
        List<Future<Object>> fs = new ArrayList<>();
        for (int i = 0; i < n; i++) fs.add(pool.submit(() -> { start.await(); return getter.get(); }));
        start.countDown(); // 同时放行，制造竞争
        Set<Object> set = Collections.newSetFromMap(new IdentityHashMap<>());
        for (Future<Object> f : fs) set.add(f.get(5, TimeUnit.SECONDS));
        pool.shutdown();
        return set.size();
    }

    public static void main(String[] args) throws Exception {
        for (int round = 0; round < 200; round++) {
            DclSingleton.resetForTest();
            DclSingleton.CREATED.set(0);
            int distinct = concurrentDistinct(DclSingleton::getInstance);
            if (distinct != 1 || DclSingleton.CREATED.get() != 1) throw new AssertionError("DCL broken");
        }
        System.out.println("DCL: 200 rounds, each created exactly once");

        System.out.println("Holder created before first access: " + HolderSingleton.CREATED.get()); // 0，证明懒加载
        int d = concurrentDistinct(HolderSingleton::getInstance);
        System.out.println("Holder: distinct=" + d + ", created=" + HolderSingleton.CREATED.get());

        System.out.println("Enum: distinct=" + concurrentDistinct(() -> EnumSingleton.INSTANCE) + ", " + EnumSingleton.INSTANCE.hello());

        // 反射可以绕过私有构造器破坏 DCL 单例
        Constructor<DclSingleton> c = DclSingleton.class.getDeclaredConstructor();
        c.setAccessible(true);
        System.out.println("reflection breaks DCL: " + (c.newInstance() != DclSingleton.getInstance()));
        // 反射创建枚举实例会被 JVM 拒绝
        try {
            Constructor<EnumSingleton> ec = EnumSingleton.class.getDeclaredConstructor(String.class, int.class);
            ec.setAccessible(true);
            ec.newInstance("X", 1);
        } catch (IllegalArgumentException e) {
            System.out.println("reflection on enum rejected: " + e.getMessage());
        }
    }
}
```

## 复杂度

- 时间：DCL / Holder / 枚举在实例创建后每次获取都是 O(1) 且无锁（DCL 只有一次 volatile 读）；`synchronized` 方法版每次都要走加锁流程。
- 空间 O(1)：只有一个实例。

## 易错点

- DCL 不加 `volatile`：可能拿到半初始化对象，这是最常被追问的点。
- 只做一次检查（锁外判空后直接进 synchronized 创建）：多个线程同时通过判空后排队进锁，会各自 new 一次。
- 在 `synchronized (this)` 上加锁：静态方法里没有 this，应锁 `Singleton.class`。
- 私有构造器可以被反射调用：可在构造器里判断"已存在就抛异常"来防御，但只有枚举是 JVM 层面保证的。
- 实现了 `Serializable` 的单例，反序列化会创建新对象，需要加 `readResolve()` 返回单例；枚举的序列化由 JVM 特殊处理，不会有这个问题。

## 追问

:::details 为什么需要两次判空？
第一次判空在锁外，是为了实例创建后不再加锁（性能）；第二次判空在锁内，是因为可能有多个线程同时通过了第一次判空、在锁外排队，第一个进锁的线程创建完后，后面进锁的线程必须再检查一次，否则会重复创建。
:::

:::details 静态内部类为什么是线程安全且懒加载的？
JVM 规范保证类的初始化（执行 `<clinit>`）只进行一次，并由 JVM 加锁，其他线程会等待初始化完成；而且初始化完成 happens-before 其他线程对该类静态字段的访问。外部类被加载时不会初始化内部类 Holder，只有首次调用 `getInstance()` 访问 `Holder.INSTANCE` 时才会触发。
:::

:::details 为什么枚举能防反射和反序列化？
`Constructor.newInstance` 遇到枚举类型会直接抛 `IllegalArgumentException("Cannot reflectively create enum objects")`；枚举序列化只写出名字，反序列化时通过 `Enum.valueOf` 找到已有常量，不会新建对象。
:::

:::details Spring 的单例和这里的单例一样吗？
不一样。Spring 的 singleton 作用域是"每个容器中一个 bean 实例"，由容器用一个 Map（单例池）管理，同一个类可以在不同容器或不同 bean 名下有多个实例；而这里是"每个 ClassLoader 中一个实例"，由类自身保证。
:::

## 举一反三

- [[algo:snowflake-id]]：ID 生成器通常就是全局单例，且内部状态需要线程安全。
- [[algo:bounded-blocking-queue]]：同样涉及 happens-before 与锁的可见性保证。
- JDK / 框架对应：`Runtime.getRuntime()` 是饿汉式单例；Spring 容器的单例池里 `DefaultSingletonBeanRegistry.getSingleton` 也用了"先无锁查缓存、再加锁二次检查"的 DCL 思路。

## 一句话记忆

DCL = 两次判空 + 锁类对象 + volatile 防重排；更简单就用静态内部类，要防反射和序列化就用枚举。
